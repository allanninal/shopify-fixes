/**
 * Reconcile Shopify inventory without racing other writers.
 *
 * Two writers, such as a checkout and a warehouse sync, can each read the same
 * available quantity and then both write a new absolute value back. Whichever
 * write lands last wins completely and silently erases the other one, so the
 * store oversells. This script reads the live available quantity right before
 * writing and passes it as compareQuantity on inventorySetQuantities, so Shopify
 * rejects the write instead of silently overwriting a change made in between.
 * Run on a schedule. Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/overselling-from-concurrent-writes/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOCATION_ID = process.env.LOCATION_ID || "gid://shopify/Location/1";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

/** Pure. Pull the 'available' quantity out of a quantities list. */
export function availableQuantity(node) {
  for (const q of node.quantities || []) {
    if (q.name === "available") return q.quantity;
  }
  return null;
}

/**
 * Pure. Return the inventorySetQuantities write to send, or null if nothing to fix.
 *
 * currentAvailable must be read immediately before this call, never cached,
 * so compareQuantity always reflects the true live value at write time. That
 * is what lets Shopify reject a write when another process already changed
 * the count, instead of silently overwriting it.
 */
export function planWrite(itemId, locationId, currentAvailable, correctAvailable) {
  if (currentAvailable === correctAvailable) return null;
  return {
    name: "available",
    reason: "correction",
    ignoreCompareQuantityFailures: false,
    quantities: [{
      inventoryItemId: itemId,
      locationId,
      quantity: correctAvailable,
      compareQuantity: currentAvailable,
    }],
  };
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

const LEVELS_QUERY = `
query($cursor: String, $locationId: ID!) {
  location(id: $locationId) {
    inventoryLevels(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        item { id sku }
        quantities(names: ["available"]) { name quantity }
      }
    }
  }
}`;

const SET_QUANTITIES_MUTATION = `
mutation($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { createdAt }
    userErrors { field message code }
  }
}`;

async function* inventoryLevels(locationId) {
  let cursor = null;
  while (true) {
    const loc = (await gql(LEVELS_QUERY, { cursor, locationId })).location;
    const data = loc.inventoryLevels;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function applyWrite(write) {
  const result = (await gql(SET_QUANTITIES_MUTATION, { input: write })).inventorySetQuantities;
  const errors = result.userErrors;
  if (errors.length) {
    const stale = errors.some((e) => e.code === "COMPARE_QUANTITY_STALE");
    if (stale) return "stale";
    throw new Error(JSON.stringify(errors));
  }
  return "applied";
}

async function correctQuantityFor(sku) {
  // Look up the truth for this SKU, for example a warehouse feed or a fresh count.
  // Replace this with your own source of correct stock before running for real.
  throw new Error("not implemented");
}

export async function run() {
  let corrected = 0;
  let stale = 0;
  for await (const node of inventoryLevels(LOCATION_ID)) {
    const itemId = node.item.id;
    const sku = node.item.sku;
    const current = availableQuantity(node);
    if (current === null) continue;
    const correct = await correctQuantityFor(sku);
    const write = planWrite(itemId, LOCATION_ID, current, correct);
    if (!write) continue;
    console.log(`SKU ${sku}: ${current} -> ${correct}. ${DRY_RUN ? "would write" : "writing"}`);
    if (!DRY_RUN) {
      const outcome = await applyWrite(write);
      if (outcome === "stale") {
        stale++;
        console.warn(`SKU ${sku}: compareQuantity stale, another write landed first. Skipping this pass.`);
        continue;
      }
    }
    corrected++;
  }
  console.log(`Done. ${corrected} item(s) ${DRY_RUN ? "to correct" : "corrected"}, ${stale} rejected as stale.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
