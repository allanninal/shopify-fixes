/**
 * Flag Shopify orders that are paid but still unfulfilled past your shipping SLA.
 *
 * A paid order that sits unfulfilled for days is a late shipment waiting to happen, but
 * nothing surfaces it on its own. This lists paid, unfulfilled, not-cancelled orders,
 * keeps the ones older than your SLA that are not on hold, and tags them for review with
 * tagsAdd so the team can catch them before the customer complains. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/orders-stuck-unfulfilled/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const SLA_DAYS = Number(process.env.SLA_DAYS || 3);
const REVIEW_TAG = process.env.REVIEW_TAG || "fulfillment-overdue";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function isoToEpoch(iso) {
  return Date.parse(iso) / 1000;
}

export function isOnHold(order) {
  const nodes = order.fulfillmentOrders?.nodes || [];
  return nodes.some((fo) => fo.status === "ON_HOLD");
}

export function isStaleUnfulfilled(order, nowEpoch, slaDays, reviewTag) {
  if (order.displayFulfillmentStatus !== "UNFULFILLED") return false;
  if ((order.tags || []).includes(reviewTag)) return false;
  if (isOnHold(order)) return false;
  if (!order.createdAt) return false;
  const ageDays = (nowEpoch - isoToEpoch(order.createdAt)) / 86400;
  return ageDays >= slaDays;
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
query($cursor: String) {
  orders(first: 25, after: $cursor,
         query: "financial_status:paid AND fulfillment_status:unfulfilled AND -status:cancelled") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt displayFulfillmentStatus tags
      fulfillmentOrders(first: 10) { nodes { status } }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* unfulfilledOrders() {
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor })).orders;
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
  const nowEpoch = Date.now() / 1000;
  let flagged = 0;
  for await (const order of unfulfilledOrders()) {
    if (!isStaleUnfulfilled(order, nowEpoch, SLA_DAYS, REVIEW_TAG)) continue;
    console.warn(`Order ${order.name} unfulfilled past SLA. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagForReview(order.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} overdue order(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
