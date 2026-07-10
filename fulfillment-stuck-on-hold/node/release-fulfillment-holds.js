/**
 * Release Shopify fulfillment holds that were never cleaned up.
 *
 * A fulfillment order can be put on hold for a real reason (fraud review, an
 * address problem, waiting on stock) and that reason gets fixed, but nothing
 * ever calls fulfillmentOrderReleaseHold, so the order sits at status ON_HOLD
 * forever. This job pages through manualHoldsFulfillmentOrders, keeps only
 * the holds this app itself applied whose reason is one we are allowed to
 * clear on our own, and only on orders a human has tagged as resolved, then
 * releases those specific hold ids with fulfillmentOrderReleaseHold. Run on
 * a schedule. Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/fulfillment-stuck-on-hold/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const RESOLVED_TAG = process.env.HOLD_RESOLVED_TAG || "hold-resolved";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

// Reasons this job is allowed to clear on its own, once a human has tagged
// the order resolved. High risk of fraud is left out on purpose: that call
// always needs a person, never a script.
export const RELEASABLE_REASONS = new Set([
  "INVENTORY_OUT_OF_STOCK",
  "INCORRECT_ADDRESS",
  "AWAITING_PAYMENT",
  "AWAITING_RETURN_ITEMS",
  "UNKNOWN_DELIVERY_DATE",
  "ONLINE_STORE_POST_PURCHASE_CROSS_SELL",
  "OTHER",
]);

/**
 * Pure decision: which hold ids on this fulfillment order are safe to release.
 *
 * Only holds this app applied itself (heldByRequestingApp) count, only when
 * the reason is in RELEASABLE_REASONS, and only when the order carries the
 * confirmation tag a human adds once the underlying problem is actually
 * fixed. Everything else is left alone for a person to release by hand.
 */
export function holdsToRelease(fulfillmentOrder, resolvedTag) {
  if (fulfillmentOrder.status !== "ON_HOLD") return [];
  const order = fulfillmentOrder.order || {};
  if (!(order.tags || []).includes(resolvedTag)) return [];
  const ids = [];
  for (const hold of fulfillmentOrder.fulfillmentHolds || []) {
    if (!hold.heldByRequestingApp) continue;
    if (!RELEASABLE_REASONS.has(hold.reason)) continue;
    ids.push(hold.id);
  }
  return ids;
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

const HELD_ORDERS_QUERY = `
query($cursor: String) {
  manualHoldsFulfillmentOrders(first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      status
      order { id name tags }
      fulfillmentHolds {
        id
        reason
        reasonNotes
        heldByRequestingApp
      }
    }
  }
}`;

const RELEASE_MUTATION = `
mutation($id: ID!, $holdIds: [ID!]) {
  fulfillmentOrderReleaseHold(id: $id, holdIds: $holdIds) {
    fulfillmentOrder { id status }
    userErrors { field message }
  }
}`;

async function* heldFulfillmentOrders() {
  let cursor = null;
  while (true) {
    const data = (await gql(HELD_ORDERS_QUERY, { cursor })).manualHoldsFulfillmentOrders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function releaseHolds(fulfillmentOrderId, holdIds) {
  const result = (await gql(RELEASE_MUTATION, { id: fulfillmentOrderId, holdIds })).fulfillmentOrderReleaseHold;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.fulfillmentOrder.status;
}

export async function run() {
  let released = 0;
  for await (const fo of heldFulfillmentOrders()) {
    const holdIds = holdsToRelease(fo, RESOLVED_TAG);
    if (!holdIds.length) continue;
    const orderName = (fo.order || {}).name || fo.id;
    console.log(
      `Fulfillment order ${orderName} has ${holdIds.length} releasable hold(s). ${DRY_RUN ? "would release" : "releasing"}`
    );
    if (!DRY_RUN) await releaseHolds(fo.id, holdIds);
    released++;
  }
  console.log(`Done. ${released} fulfillment order(s) ${DRY_RUN ? "to release" : "released"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
