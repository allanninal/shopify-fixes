/**
 * Find Shopify checkouts that were actually paid but never became an order.
 *
 * A checkout can finish payment (Shopify records completedAt on the abandoned
 * checkout record) while the order write never lands, for example a webhook
 * that timed out, an app that crashed mid write, or a duplicate submit that
 * raced itself. Shopify's own abandoned checkout report still calls this
 * "abandoned" because no order followed, so real, paid checkouts hide in a
 * list meant for carts nobody finished. This job lists recently completed
 * checkouts, checks whether a matching order exists with checkout_token, and
 * tags the ones that are paid with nothing behind them for a human to
 * reconcile with reconcileTag. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/paid-checkouts-stranded-as-abandoned/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 3);
const MIN_STRANDED_CENTS = Number(process.env.MIN_STRANDED_CENTS || 1);
const RECONCILE_TAG = process.env.RECONCILE_TAG || "stranded-checkout";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function checkoutTokenFromGid(gid) {
  // gid://shopify/AbandonedCheckout/123 -> "123", the same token orders were written with.
  return gid.split("/").pop();
}

export function isStranded(checkout, hasMatchingOrder, minCents = MIN_STRANDED_CENTS) {
  if (!checkout.completedAt) return false;
  if (hasMatchingOrder) return false;
  const amount = checkout.totalPriceSet?.shopMoney?.amount ?? "0";
  return toCents(amount) >= minCents;
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

const ABANDONED_CHECKOUTS_QUERY = `
query($cursor: String) {
  abandonedCheckouts(first: 50, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      completedAt
      updatedAt
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { email }
    }
  }
}`;

const ORDER_BY_CHECKOUT_TOKEN_QUERY = `
query($q: String!) {
  orders(first: 1, query: $q) {
    nodes { id name }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* recentlyCompletedCheckouts() {
  let cursor = null;
  while (true) {
    const data = (await gql(ABANDONED_CHECKOUTS_QUERY, { cursor })).abandonedCheckouts;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function orderExistsForCheckout(checkoutGid) {
  const token = checkoutTokenFromGid(checkoutGid);
  const data = (await gql(ORDER_BY_CHECKOUT_TOKEN_QUERY, { q: `checkout_token:${token}` })).orders;
  return data.nodes.length > 0;
}

async function tagForReconciliation(checkoutId, reconcileTag) {
  const result = (await gql(TAGS_ADD, { id: checkoutId, tags: [reconcileTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let flagged = 0;
  for await (const checkout of recentlyCompletedCheckouts()) {
    if (!checkout.completedAt) continue;
    const hasOrder = await orderExistsForCheckout(checkout.id);
    if (!isStranded(checkout, hasOrder)) continue;
    console.warn(`Checkout ${checkout.name || checkout.id} completed with no order. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagForReconciliation(checkout.id, RECONCILE_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} checkout(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
