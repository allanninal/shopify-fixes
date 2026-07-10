/**
 * Flag Shopify orders whose transactions do not add up to what was received.
 *
 * The money on an order should tie out: captures minus refunds equals the amount
 * received. When they drift apart (a failed refund still counted, a gateway hiccup,
 * a manual edit), the order's ledger is wrong and reports quietly lie. This sums each
 * recent order's successful transactions, compares them to totalReceivedSet, and tags
 * the ones that do not match for review with tagsAdd. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/transactions-total-mismatch/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 7);
const REVIEW_TAG = process.env.REVIEW_TAG || "ledger-mismatch";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CHARGE_KINDS = new Set(["SALE", "CAPTURE"]);

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function netCapturedCents(transactions) {
  let total = 0;
  for (const t of transactions || []) {
    if (t.status !== "SUCCESS") continue;
    const amount = toCents(t.amountSet.shopMoney.amount);
    if (CHARGE_KINDS.has(t.kind)) total += amount;
    else if (t.kind === "REFUND") total -= amount;
  }
  return total;
}

export function isMismatch(order) {
  const received = toCents(order.totalReceivedSet?.shopMoney?.amount ?? "0");
  return Math.abs(netCapturedCents(order.transactions) - received) > 1;
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
      totalReceivedSet { shopMoney { amount currencyCode } }
      transactions(first: 30) {
        id kind status
        amountSet { shopMoney { amount currencyCode } }
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
    if (!isMismatch(order)) continue;
    if ((order.tags || []).includes(REVIEW_TAG)) continue;
    console.warn(`Order ${order.name} ledger does not tie out. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagForReview(order.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} order(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
