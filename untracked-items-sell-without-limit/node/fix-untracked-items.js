/**
 * Turn inventory tracking back on for Shopify variants that sell without limit.
 *
 * A variant with inventoryItem.tracked set to false has no quantity behind it, so
 * it never runs out no matter how many orders come in. Some untracked variants are
 * meant to be that way, like services or digital goods, so this only turns tracking
 * on for variants that are untracked, have real recent sales, and carry a confirmation
 * tag you add once you have reviewed them. Run on a schedule. Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/untracked-items-sell-without-limit/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const TRACK_TAG = process.env.TRACK_FIX_TAG || "track-me";
const MIN_RECENT_SALES = Number(process.env.MIN_RECENT_SALES || 1);
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 30);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

/**
 * Pure decision: should this variant have tracking turned on?
 *
 * True only when the inventory item is currently untracked, it has sold at
 * least minSales units in the lookback window, and the product carries the
 * confirmation tag a human adds once they have reviewed it.
 */
export function eligibleToTrack(variant, recentSales, requiredTag, minSales = 1) {
  const inventoryItem = variant.inventoryItem || {};
  if (inventoryItem.tracked) return false;
  if (recentSales < minSales) return false;
  const tags = variant.product?.tags || [];
  return tags.includes(requiredTag);
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

const VARIANTS_QUERY = `
query($cursor: String) {
  productVariants(first: 50, after: $cursor, query: "inventory_total:0") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      product { tags }
      inventoryItem { id tracked }
    }
  }
}`;

const RECENT_ORDERS_QUERY = `
query($cursor: String, $q: String!) {
  orders(first: 50, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      lineItems(first: 50) {
        nodes { quantity variant { id } }
      }
    }
  }
}`;

const TRACK_MUTATION = `
mutation($id: ID!, $input: InventoryItemInput!) {
  inventoryItemUpdate(id: $id, input: $input) {
    inventoryItem { id tracked }
    userErrors { field message }
  }
}`;

async function* candidateVariants() {
  let cursor = null;
  while (true) {
    const data = (await gql(VARIANTS_QUERY, { cursor })).productVariants;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function recentSalesCount(variantId, lookbackDays) {
  const q = `created_at:>-${lookbackDays}d`;
  let cursor = null;
  let total = 0;
  while (true) {
    const data = (await gql(RECENT_ORDERS_QUERY, { cursor, q })).orders;
    for (const order of data.nodes) {
      for (const item of order.lineItems.nodes) {
        if (item.variant?.id === variantId) total += item.quantity;
      }
    }
    if (!data.pageInfo.hasNextPage) return total;
    cursor = data.pageInfo.endCursor;
  }
}

async function turnTrackingOn(inventoryItemId) {
  const result = (await gql(TRACK_MUTATION, { id: inventoryItemId, input: { tracked: true } })).inventoryItemUpdate;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.inventoryItem.tracked;
}

export async function run() {
  let fixed = 0;
  for await (const variant of candidateVariants()) {
    const sales = await recentSalesCount(variant.id, LOOKBACK_DAYS);
    if (!eligibleToTrack(variant, sales, TRACK_TAG, MIN_RECENT_SALES)) continue;
    console.log(`Variant ${variant.id} untracked with ${sales} recent sales. ${DRY_RUN ? "dry run" : "turning tracking on"}`);
    if (!DRY_RUN) await turnTrackingOn(variant.inventoryItem.id);
    fixed++;
  }
  console.log(`Done. ${fixed} variant(s) ${DRY_RUN ? "to fix" : "fixed"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
