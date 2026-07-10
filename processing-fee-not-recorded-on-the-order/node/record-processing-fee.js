/**
 * Record the Shopify Payments processing fee onto its order, safely.
 *
 * The order total is what the customer paid, not what you kept. The fee lives on
 * the order's own successful transactions as a TransactionFee, never on the order.
 * This sums the fee on each recent order's successful sale and capture transactions
 * and writes it back as a metafield in cents, once, so reports can compute net
 * revenue without a second trip to the payout report. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/processing-fee-not-recorded-on-the-order/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 14);
const FEE_NAMESPACE = process.env.FEE_METAFIELD_NAMESPACE || "recon";
const FEE_KEY = process.env.FEE_METAFIELD_KEY || "processing_fee_cents";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CHARGE_KINDS = new Set(["SALE", "CAPTURE"]);

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function feeCentsForOrder(order) {
  // Sum the processing fee on successful sale and capture transactions.
  // Returns the fee in cents, or null if there is nothing new to record
  // (the order already carries the metafield, or no fee was found).
  // This function does no I/O, so it can be unit tested with plain objects.
  if ((order.feeMetafield || {}).value != null) return null; // already recorded
  let total = 0;
  for (const t of order.transactions || []) {
    if (t.status !== "SUCCESS" || !CHARGE_KINDS.has(t.kind)) continue;
    for (const fee of t.fees || []) total += toCents(fee.amount.amount);
  }
  return total > 0 ? total : null;
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
query($cursor: String, $q: String!, $ns: String!, $key: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      feeMetafield: metafield(namespace: $ns, key: $key) { value }
      transactions(first: 10) {
        kind
        status
        fees { amount { amount currencyCode } }
      }
    }
  }
}`;

const SET_FEE_MUTATION = `
mutation($id: ID!, $ns: String!, $key: String!, $value: String!) {
  orderUpdate(input: {
    id: $id
    metafields: [{ namespace: $ns, key: $key, type: "number_integer", value: $value }]
  }) {
    order { id }
    userErrors { field message }
  }
}`;

async function* recentOrders() {
  const q = `created_at:>-${LOOKBACK_DAYS}d`;
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor, q, ns: FEE_NAMESPACE, key: FEE_KEY })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function writeFee(orderId, feeCents) {
  const result = (await gql(SET_FEE_MUTATION, {
    id: orderId, ns: FEE_NAMESPACE, key: FEE_KEY, value: String(feeCents),
  })).orderUpdate;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let recorded = 0;
  for await (const order of recentOrders()) {
    const feeCents = feeCentsForOrder(order);
    if (feeCents === null) continue;
    console.log(`Order ${order.name} fee ${feeCents} cents. ${DRY_RUN ? "dry run" : "recording"}`);
    if (!DRY_RUN) await writeFee(order.id, feeCents);
    recorded++;
  }
  console.log(`Done. ${recorded} order(s) ${DRY_RUN ? "to record" : "recorded"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
