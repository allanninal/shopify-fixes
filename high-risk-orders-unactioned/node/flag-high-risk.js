/**
 * Flag high-risk Shopify orders that slipped through without review.
 *
 * Shopify scores orders for fraud risk, but a HIGH risk order still ships if nobody
 * looks at it. This lists recent open orders, keeps the ones Shopify rated high risk
 * (or recommended to cancel) that are not already tagged, and adds a review tag with
 * tagsAdd so staff catch them before fulfillment. Run on a schedule. Safe to re-run.
 *
 * Guide: https://www.allanninal.dev/shopify/high-risk-orders-unactioned/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const REVIEW_TAG = process.env.REVIEW_TAG || "fraud-review";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function isHighRisk(order) {
  const risk = order.risk || {};
  if (risk.recommendation === "CANCEL") return true;
  return (risk.assessments || []).some((a) => a.riskLevel === "HIGH");
}

export function needsReview(order, reviewTag) {
  if (order.cancelledAt) return false;
  if ((order.tags || []).includes(reviewTag)) return false;
  return isHighRisk(order);
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
  orders(first: 25, after: $cursor, query: "fulfillment_status:unfulfilled AND -status:cancelled") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name cancelledAt tags
      risk { recommendation assessments { riskLevel } }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node { id }
    userErrors { field message }
  }
}`;

async function* openOrders() {
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
  let flagged = 0;
  for await (const order of openOrders()) {
    if (!needsReview(order, REVIEW_TAG)) continue;
    console.warn(`Order ${order.name} is high risk and unreviewed. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagForReview(order.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} high-risk order(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
