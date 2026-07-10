/**
 * Flag Shopify orders where the presentment currency and the settlement currency
 * do not agree in the way your reports expect.
 *
 * A buyer in the UK sees GBP at checkout (presentmentMoney), but if your store settles
 * in USD, the money that actually lands in your payout is in USD (shopMoney). Reports
 * that read the wrong side of that pair, or that mix the two without converting, end up
 * quietly wrong. This job reads each recent order's totalReceivedSet on both sides,
 * computes the implied exchange rate, and tags for review any order where the currency
 * pair looks unexpected or the implied rate falls outside a sane band. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/presentment-vs-settlement-currency-shopify/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 7);
const SETTLEMENT_CURRENCY = process.env.SETTLEMENT_CURRENCY || "USD";
const REVIEW_TAG = process.env.REVIEW_TAG || "currency-mismatch";
const MIN_RATE = Number(process.env.MIN_RATE || 0.01);
const MAX_RATE = Number(process.env.MAX_RATE || 100);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function impliedRate(shopCents, presentmentCents) {
  if (shopCents === 0 || presentmentCents === 0) return null;
  return presentmentCents / shopCents;
}

export function needsReview(order, settlementCurrency, minRate, maxRate) {
  const totals = order.totalReceivedSet || {};
  const shop = totals.shopMoney || {};
  const presentment = totals.presentmentMoney || {};

  const shopCurrency = shop.currencyCode;
  const presentmentCurrency = presentment.currencyCode;
  if (shopCurrency == null || presentmentCurrency == null) return false;

  if (shopCurrency !== settlementCurrency) return true;

  const shopCents = toCents(shop.amount ?? "0");
  const presentmentCents = toCents(presentment.amount ?? "0");

  if (shopCurrency === presentmentCurrency) {
    return shopCents !== presentmentCents;
  }

  const rate = impliedRate(shopCents, presentmentCents);
  if (rate === null) return true;
  return rate < minRate || rate > maxRate;
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
      totalReceivedSet {
        shopMoney { amount currencyCode }
        presentmentMoney { amount currencyCode }
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
    if (!needsReview(order, SETTLEMENT_CURRENCY, MIN_RATE, MAX_RATE)) continue;
    if ((order.tags || []).includes(REVIEW_TAG)) continue;
    console.warn(`Order ${order.name} currency pair looks off. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagForReview(order.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} order(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
