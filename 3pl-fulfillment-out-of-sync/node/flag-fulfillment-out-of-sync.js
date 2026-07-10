/**
 * Flag Shopify fulfillment orders the 3PL already shipped but Shopify still shows open.
 *
 * A third-party warehouse ships the box and hands the carrier a tracking number, but the
 * webhook or API call that was supposed to tell Shopify "this is done" never lands, or it
 * lands and silently fails. The result: a Fulfillment record exists with status SUCCESS
 * and real tracking info, yet the parent FulfillmentOrder is still IN_PROGRESS or OPEN.
 * Shopify keeps waving at the merchant to fulfill an order that is already on a truck.
 *
 * This job walks recent orders, looks at each fulfillment order together with the
 * fulfillments attached to it, and tags for review the ones where the warehouse has
 * clearly finished the job but Shopify has not caught up. It never forces a fulfillment
 * order closed itself, since that transition belongs to the fulfillment service app that
 * accepted the request. Tagging is the safe, universally permitted action. Run on a
 * schedule. Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/3pl-fulfillment-out-of-sync/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 14);
const REVIEW_TAG = process.env.REVIEW_TAG || "3pl-out-of-sync";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const OPEN_FULFILLMENT_ORDER_STATUSES = new Set(["IN_PROGRESS", "OPEN"]);

/** A fulfillment counts as shipped when the 3PL reported success with a real tracking number. */
export function hasShippedTracking(fulfillment) {
  if (fulfillment.status !== "SUCCESS") return false;
  const tracking = fulfillment.trackingInfo || [];
  return tracking.some((t) => (t.number || "").trim().length > 0);
}

/**
 * Pure decision: does this fulfillment order look stuck while the 3PL already shipped it?
 *
 * True only when Shopify still reports the fulfillment order as IN_PROGRESS or OPEN,
 * and at least one linked fulfillment already succeeded with tracking attached.
 */
export function fulfillmentOrderOutOfSync(fulfillmentOrder) {
  if (!OPEN_FULFILLMENT_ORDER_STATUSES.has(fulfillmentOrder.status)) return false;
  const fulfillments = fulfillmentOrder.fulfillments?.nodes || [];
  return fulfillments.some(hasShippedTracking);
}

/** An order needs review when any of its fulfillment orders is out of sync. */
export function orderNeedsReview(order) {
  const fulfillmentOrders = order.fulfillmentOrders?.nodes || [];
  return fulfillmentOrders.some(fulfillmentOrderOutOfSync);
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
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
          fulfillments(first: 10) {
            nodes {
              id
              status
              trackingInfo(first: 5) { company number url }
            }
          }
        }
      }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* recentOrders() {
  const q = `created_at:>-${LOOKBACK_DAYS}d`;
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor, q })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function tagForReview(orderId, reviewTag) {
  const result = (await gql(TAGS_ADD, { id: orderId, tags: [reviewTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let flagged = 0;
  for await (const order of recentOrders()) {
    if (!orderNeedsReview(order)) continue;
    if ((order.tags || []).includes(REVIEW_TAG)) continue;
    console.warn(`Order ${order.name} has a shipped fulfillment order still open. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagForReview(order.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} order(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
