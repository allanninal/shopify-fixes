/**
 * Backfill Shopify orders whose webhooks were missed during downtime.
 *
 * Shopify retries a failing webhook for up to 48 hours, then drops it for
 * good. If your endpoint was down longer than that, some orders never told
 * you they were paid, fulfilled, or cancelled. This job polls orders updated
 * during the outage window, keeps only the ones whose updatedAt falls inside
 * that window and that have not already been reprocessed, and re-applies the
 * update by tagging the order and logging what would have shipped in the
 * missed webhook. Read heavy, one small write. Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/missed-webhooks-with-no-backfill/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

// The window your app was unreachable, in ISO 8601. Widen it a little on
// both sides, since Shopify's retry schedule is not instant either.
const GAP_START = process.env.GAP_START || "2026-07-05T00:00:00Z";
const GAP_END = process.env.GAP_END || "2026-07-06T00:00:00Z";
const BACKFILL_TAG = process.env.BACKFILL_TAG || "webhook-backfilled";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

/**
 * Pure decision. True when an order's own update happened inside the outage
 * window and it has not already been marked as reprocessed.
 */
export function needsBackfill(order, gapStart, gapEnd, doneTag) {
  const updatedAt = order.updatedAt;
  if (!updatedAt) return false;
  if (!(updatedAt >= gapStart && updatedAt <= gapEnd)) return false;
  return !(order.tags || []).includes(doneTag);
}

/**
 * What the missed webhook would have told us, in plain fields we can log or
 * replay into a local system. Money is kept in cents.
 */
export function summarize(order) {
  const amount = order.totalReceivedSet?.shopMoney?.amount ?? "0";
  return {
    id: order.id,
    name: order.name,
    financialStatus: order.displayFinancialStatus,
    fulfillmentStatus: order.displayFulfillmentStatus,
    cancelled: Boolean(order.cancelledAt),
    totalReceivedCents: toCents(amount),
  };
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
  orders(first: 50, after: $cursor, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name tags updatedAt
      displayFinancialStatus
      displayFulfillmentStatus
      cancelledAt
      totalReceivedSet { shopMoney { amount currencyCode } }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* updatedOrdersInGap() {
  const q = `updated_at:>='${GAP_START}' AND updated_at:<='${GAP_END}'`;
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor, q })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function markBackfilled(orderId, doneTag) {
  const result = (await gql(TAGS_ADD, { id: orderId, tags: [doneTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let backfilled = 0;
  for await (const order of updatedOrdersInGap()) {
    if (!needsBackfill(order, GAP_START, GAP_END, BACKFILL_TAG)) continue;
    const state = summarize(order);
    console.log(
      `Order ${state.name} missed a webhook. financial=${state.financialStatus} ` +
      `fulfillment=${state.fulfillmentStatus} received_cents=${state.totalReceivedCents}. ` +
      `${DRY_RUN ? "would backfill" : "backfilling"}`
    );
    if (!DRY_RUN) {
      // Apply your own side effect here: sync to your database, send an
      // internal event, trigger fulfillment, etc. Then mark it done so a
      // later run never replays the same order twice.
      await markBackfilled(order.id, BACKFILL_TAG);
    }
    backfilled++;
  }
  console.log(`Done. ${backfilled} order(s) ${DRY_RUN ? "to backfill" : "backfilled"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
