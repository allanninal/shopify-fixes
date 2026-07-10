/**
 * Detect and repair Shopify orders that were double-processed by a duplicate webhook delivery.
 *
 * Shopify retries a webhook when your endpoint is slow or returns a non-2xx status, and the
 * same delivery can also arrive twice over the network. Every delivery carries a unique
 * X-Shopify-Webhook-Id header. If a handler does not check that id before acting, a retried
 * "orders/paid" delivery can double-apply a side effect, such as granting store credit twice.
 *
 * This script does not sit in the webhook path. It reconciles after the fact: it reads the
 * ledger of processed webhook ids each handler is expected to stamp onto the order (as tags
 * in the form wh-<webhook id>), finds orders where the same webhook id shows up more than
 * once, and tags those orders for review with tagsAdd. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/duplicate-webhook-deliveries-run-twice/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 7);
const REVIEW_TAG = process.env.REVIEW_TAG || "duplicate-webhook";
const WEBHOOK_TAG_PREFIX = process.env.WEBHOOK_TAG_PREFIX || "wh-";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function webhookIdsSeen(tags, prefix) {
  return (tags || []).filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
}

/**
 * Pure decision function, no I/O.
 *
 * Given an order's tags, return the first webhook id that was stamped more than once,
 * or null if every delivery the order has seen so far was processed exactly once.
 */
export function findDuplicateWebhookId(tags, prefix) {
  const seen = new Set();
  for (const wid of webhookIdsSeen(tags, prefix)) {
    if (seen.has(wid)) return wid;
    seen.add(wid);
  }
  return null;
}

export function alreadyFlagged(tags, reviewTag) {
  return (tags || []).includes(reviewTag);
}

/** Pure decision function, no I/O. Decides whether an order needs a review tag. */
export function shouldFlagForReview(order, prefix, reviewTag) {
  if (alreadyFlagged(order.tags, reviewTag)) return false;
  return findDuplicateWebhookId(order.tags, prefix) !== null;
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
  orders(first: 50, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      tags
      totalReceivedSet { shopMoney { amount currencyCode } }
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

async function flagForReview(orderId, reviewTag) {
  const result = (await gql(TAGS_ADD, { id: orderId, tags: [reviewTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let flagged = 0;
  for await (const order of recentOrders()) {
    if (!shouldFlagForReview(order, WEBHOOK_TAG_PREFIX, REVIEW_TAG)) continue;
    const dupId = findDuplicateWebhookId(order.tags, WEBHOOK_TAG_PREFIX);
    const receivedCents = toCents(order.totalReceivedSet?.shopMoney?.amount ?? "0");
    console.warn(
      `Order ${order.name} saw webhook id ${dupId} more than once (received ${receivedCents} cents). ${DRY_RUN ? "would tag" : "tagging"}`
    );
    if (!DRY_RUN) await flagForReview(order.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} order(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
