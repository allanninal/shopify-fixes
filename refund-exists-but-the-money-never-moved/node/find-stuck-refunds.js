/**
 * Flag Shopify orders whose refund exists but the money never actually moved.
 *
 * A refund record can sit on an order while the gateway transaction underneath it
 * failed, errored, or never left PENDING. This sums each refund's SUCCESS-only
 * transactions in minor units, compares that to the refund's own totalRefundedSet,
 * and tags the order for review with tagsAdd when they do not match. Run on a
 * schedule. Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/refund-exists-but-the-money-never-moved/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 14);
const REVIEW_TAG = process.env.REVIEW_TAG || "refund-stuck";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function movedCents(refund) {
  let total = 0;
  for (const t of refund.transactions?.nodes || []) {
    if (t.status === "SUCCESS") total += toCents(t.amountSet.shopMoney.amount);
  }
  return total;
}

export function isStuckRefund(refund) {
  const claimed = toCents(refund.totalRefundedSet?.shopMoney?.amount ?? "0");
  return Math.abs(movedCents(refund) - claimed) > 1;
}

export function hasStuckRefund(order) {
  return (order.refunds || []).some(isStuckRefund);
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
      id name tags
      refunds {
        id
        totalRefundedSet { shopMoney { amount currencyCode } }
        transactions(first: 10) {
          nodes { kind status amountSet { shopMoney { amount currencyCode } } }
        }
      }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* refundedOrders() {
  const q = `created_at:>-${LOOKBACK_DAYS}d AND financial_status:refunded OR financial_status:partially_refunded`;
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
  for await (const order of refundedOrders()) {
    if (!hasStuckRefund(order)) continue;
    if ((order.tags || []).includes(REVIEW_TAG)) continue;
    console.warn(`Order ${order.name} has a refund that never moved the money. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagForReview(order.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} order(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
