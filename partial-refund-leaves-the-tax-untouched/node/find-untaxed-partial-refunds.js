/**
 * Flag (and optionally fix) Shopify partial refunds that gave back the item but
 * kept the tax.
 *
 * A partial refund that only sets a refund line item amount, with no matching
 * orderAdjustment or transaction for tax, leaves the tax portion sitting on the
 * order. The customer paid tax on money they no longer owe. This job walks
 * recent refunds, works out the tax that should have come back for each set of
 * refunded line items (proportional to what the order originally charged), compares
 * it to the tax Shopify actually refunded, and when the gap is real it issues a
 * follow-up refund for the missing tax only. Read-only unless DRY_RUN is false.
 * Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/partial-refund-leaves-the-tax-untouched/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 14);
const MIN_GAP_CENTS = Number(process.env.MIN_GAP_CENTS || 2);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

/**
 * The tax the order originally charged on one unit, as a fraction of the unit price.
 * Returns 0 when the line item has no price (avoids a division by zero) or carries
 * no tax lines (a tax-exempt product, for example).
 */
export function lineItemTaxRate(lineItem) {
  const unitPrice = toCents(lineItem.originalUnitPriceSet.shopMoney.amount);
  if (unitPrice <= 0) return 0;
  const taxCents = (lineItem.taxLines || []).reduce(
    (sum, t) => sum + toCents(t.priceSet.shopMoney.amount),
    0
  );
  const quantity = lineItem.quantity || 1;
  return taxCents / (unitPrice * quantity);
}

/**
 * The tax that should be refunded for one refund, in cents.
 *
 * For every refunded line item we take its refunded subtotal (what the customer
 * got back for the goods) and apply the original tax rate for that line item.
 * This mirrors how Shopify computed the tax in the first place, so a refund
 * that already includes tax will match and one that skipped it will not.
 */
export function expectedTaxCentsForRefund(refund, lineItemsById) {
  let total = 0;
  for (const rli of refund.refundLineItems?.nodes || []) {
    const lineItem = lineItemsById[rli.lineItem.id];
    if (!lineItem) continue;
    const refundedSubtotalCents = toCents(rli.subtotalSet.shopMoney.amount);
    total += refundedSubtotalCents * lineItemTaxRate(lineItem);
  }
  return total;
}

export function actualTaxRefundedCents(refund) {
  return (refund.refundLineItems?.nodes || []).reduce(
    (sum, rli) => sum + toCents(rli.totalTaxSet.shopMoney.amount),
    0
  );
}

/**
 * Pure decision function. Returns the missing tax in cents, or 0 if none is owed.
 *
 * A gap only counts when it clears minGapCents, so rounding noise of a cent or
 * two never triggers a correction. Never returns a negative number: if the
 * refund already gave back more tax than expected, that is not this job's
 * problem to fix.
 */
export function untaxedRefundGapCents(refund, lineItemsById, minGapCents = MIN_GAP_CENTS) {
  if (!(refund.refundLineItems?.nodes || []).length) return 0;
  const expected = expectedTaxCentsForRefund(refund, lineItemsById);
  const actual = actualTaxRefundedCents(refund);
  const gap = Math.round(expected - actual);
  if (gap < minGapCents) return 0;
  return gap;
}

export function orderLineItemsById(order) {
  const map = {};
  for (const li of order.lineItems.nodes) map[li.id] = li;
  return map;
}

export function centsToAmount(cents) {
  return (cents / 100).toFixed(2);
}

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

const ORDERS_QUERY = `
query($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      currentTotalTaxSet { shopMoney { amount } }
      lineItems(first: 100) {
        nodes {
          id
          quantity
          originalUnitPriceSet { shopMoney { amount } }
          taxLines { priceSet { shopMoney { amount } } }
        }
      }
      refunds(first: 20) {
        id
        createdAt
        totalRefundedSet { shopMoney { amount } }
        refundLineItems(first: 50) {
          nodes {
            quantity
            lineItem { id }
            subtotalSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
          }
        }
        transactions(first: 10) {
          nodes { kind status amountSet { shopMoney { amount } } }
        }
      }
    }
  }
}`;

const REFUND_CREATE = `
mutation($input: RefundInput!) {
  refundCreate(input: $input) {
    refund { id totalRefundedSet { shopMoney { amount } } }
    userErrors { field message }
  }
}`;

async function* recentOrdersWithRefunds() {
  const q = `created_at:>-${LOOKBACK_DAYS}d AND financial_status:partially_refunded`;
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor, q })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function refundMissingTax(orderId, gapCents) {
  const input = {
    orderId,
    note: "Automatic correction: tax portion missed on an earlier partial refund",
    transactions: [
      { orderId, kind: "REFUND", gateway: "manual", amount: centsToAmount(gapCents) },
    ],
  };
  const result = (await gql(REFUND_CREATE, { input })).refundCreate;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.refund;
}

export async function run() {
  let fixed = 0;
  for await (const order of recentOrdersWithRefunds()) {
    const lineItemsById = orderLineItemsById(order);
    for (const refund of order.refunds || []) {
      const gapCents = untaxedRefundGapCents(refund, lineItemsById);
      if (gapCents <= 0) continue;
      console.warn(
        `Order ${order.name} refund ${refund.id} is missing ${centsToAmount(gapCents)} of tax. ${
          DRY_RUN ? "would refund" : "refunding"
        }`
      );
      if (!DRY_RUN) await refundMissingTax(order.id, gapCents);
      fixed++;
    }
  }
  console.log(`Done. ${fixed} refund(s) ${DRY_RUN ? "to correct" : "corrected"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
