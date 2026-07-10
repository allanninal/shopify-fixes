/**
 * Flag Shopify test and Bogus Gateway orders that leaked into live reporting.
 *
 * Every order placed with Shopify's own test mode, or paid through the Bogus
 * Gateway used in development stores and checkout QA, carries a `test` flag
 * set to true. Those orders are not real sales, but they still show up in
 * the Orders list, in exports, and in anything that reads the Admin API
 * without checking that flag. This walks recent orders, decides which ones
 * are test or bogus-gateway orders with a pure function, and tags the ones
 * that are not already tagged so reports and automations can filter them
 * out. It never deletes or cancels an order. Read and tag only. Run on a
 * schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/test-and-bogus-gateway-orders-in-live-data/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const REVIEW_TAG = process.env.TEST_ORDER_TAG || "test-order";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const BOGUS_GATEWAYS = new Set(["bogus", "bogus_gateway"]);

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function usesBogusGateway(transactions) {
  for (const t of transactions || []) {
    const gateway = (t.gateway || "").toLowerCase();
    if (BOGUS_GATEWAYS.has(gateway)) return true;
  }
  return false;
}

export function isTestOrder(order) {
  if (order.test) return true;
  return usesBogusGateway(order.transactions);
}

export function needsTag(order, reviewTag) {
  if (!isTestOrder(order)) return false;
  return !(order.tags || []).includes(reviewTag);
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
  orders(first: 50, after: $cursor, query: "created_at:>-30d") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name test tags
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      transactions(first: 10) { gateway }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* recentOrders() {
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function tagAsTest(orderId, reviewTag) {
  const result = (await gql(TAGS_ADD, { id: orderId, tags: [reviewTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let flagged = 0;
  let leakedCents = 0;
  for await (const order of recentOrders()) {
    if (!isTestOrder(order)) continue;
    const amount = order.currentTotalPriceSet?.shopMoney?.amount ?? "0";
    leakedCents += toCents(amount);
    if (!needsTag(order, REVIEW_TAG)) continue;
    console.warn(`Order ${order.name} is test or bogus-gateway data. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagAsTest(order.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} order(s) ${DRY_RUN ? "to tag" : "tagged"}. ${(leakedCents / 100).toFixed(2)} in test money seen in the window.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
