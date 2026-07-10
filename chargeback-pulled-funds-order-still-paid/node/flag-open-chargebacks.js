/**
 * Write the dispute state onto Shopify orders that still show Paid.
 *
 * A chargeback pulls the money through the card network right away, but Shopify
 * does not flip displayFinancialStatus when a dispute opens. The order keeps
 * reading Paid while the funds are already gone, so it slips past reconciliation
 * and reporting. This job lists recently paid orders, reads their disputes, and
 * tags the ones with an open chargeback so the order carries the true state.
 * Read-only apart from the tag. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/chargeback-pulled-funds-order-still-paid/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 30);
const CHARGEBACK_TAG = process.env.CHARGEBACK_TAG || "chargeback-open";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const OPEN_DISPUTE_STATUSES = new Set(["NEEDS_RESPONSE", "UNDER_REVIEW"]);
const STILL_LOOKS_PAID = new Set(["PAID", "PARTIALLY_REFUNDED"]);

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function hasOpenChargeback(order) {
  for (const dispute of order.disputes || []) {
    if (dispute.initiatedAs !== "CHARGEBACK") continue;
    if (OPEN_DISPUTE_STATUSES.has(dispute.status)) return true;
  }
  return false;
}

/**
 * Pure decision: should this order be tagged as carrying an open chargeback?
 * True only when the order still displays as paid or partially refunded,
 * it has at least one open chargeback dispute, and it is not already tagged.
 */
export function needsFlag(order, requiredTag) {
  if (!STILL_LOOKS_PAID.has(order.displayFinancialStatus)) return false;
  if (!hasOpenChargeback(order)) return false;
  return !(order.tags || []).includes(requiredTag);
}

/**
 * Sum of the shopMoney amount received on the order, in minor units.
 * Exposed for reporting only; the decision above never depends on the
 * exact amount, only on whether an open chargeback exists.
 */
export function disputedAmountCents(order) {
  const received = order.totalReceivedSet?.shopMoney?.amount ?? "0";
  return toCents(received);
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
      tags
      displayFinancialStatus
      totalReceivedSet { shopMoney { amount currencyCode } }
      disputes { id initiatedAs status }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* recentlyPaidOrders() {
  const q = `created_at:>-${LOOKBACK_DAYS}d AND (financial_status:paid OR financial_status:partially_refunded)`;
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor, q })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function flagOrder(orderId, tag) {
  const result = (await gql(TAGS_ADD, { id: orderId, tags: [tag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let flagged = 0;
  for await (const order of recentlyPaidOrders()) {
    if (!needsFlag(order, CHARGEBACK_TAG)) continue;
    console.warn(
      `Order ${order.name} shows ${order.displayFinancialStatus} but has an open chargeback for ${disputedAmountCents(order)} cents. ${DRY_RUN ? "would tag" : "tagging"}`
    );
    if (!DRY_RUN) await flagOrder(order.id, CHARGEBACK_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} order(s) ${DRY_RUN ? "to flag" : "flagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
