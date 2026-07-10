/**
 * Find and correct Shopify variants that oversold into negative inventory.
 *
 * When the inventory policy allows selling past zero (CONTINUE), a burst of orders
 * can drive a location's available count below zero. Negative stock skews reports
 * and reorder math. This lists variants, finds locations where available is negative,
 * and sets them back to zero with inventorySetQuantities using compareQuantity so a
 * concurrent change is not clobbered. Run on a schedule. Safe to run again.
 *
 * Guide: https://www.allanninal.dev/shopify/negative-inventory-oversell/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function availableOf(level) {
  for (const q of level.quantities || []) {
    if (q.name === "available") return q.quantity;
  }
  return null;
}

export function oversoldLevels(variant) {
  const out = [];
  const item = variant.inventoryItem || {};
  for (const lvl of item.inventoryLevels?.nodes || []) {
    const avail = availableOf(lvl);
    if (avail !== null && avail < 0) {
      out.push({ inventoryItemId: item.id, locationId: lvl.location?.id, available: avail });
    }
  }
  return out;
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
  productVariants(first: 50, after: $cursor, query: "inventory_quantity:<0") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id sku
      inventoryItem {
        id
        inventoryLevels(first: 20) {
          nodes {
            location { id name }
            quantities(names: ["available"]) { name quantity }
          }
        }
      }
    }
  }
}`;

const SET_MUTATION = `
mutation($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { id }
    userErrors { field message }
  }
}`;

async function* oversoldVariants() {
  let cursor = null;
  while (true) {
    const data = (await gql(VARIANTS_QUERY, { cursor })).productVariants;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function correct(inventoryItemId, locationId, current) {
  const result = (await gql(SET_MUTATION, {
    input: {
      name: "available",
      reason: "correction",
      ignoreCompareQuantity: false,
      quantities: [{ inventoryItemId, locationId, quantity: 0, compareQuantity: current }],
    },
  })).inventorySetQuantities;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let fixed = 0;
  for await (const variant of oversoldVariants()) {
    for (const lvl of oversoldLevels(variant)) {
      console.warn(`Variant ${variant.sku || variant.id} at ${lvl.locationId} is ${lvl.available}. ${DRY_RUN ? "would set to 0" : "setting to 0"}`);
      if (!DRY_RUN) await correct(lvl.inventoryItemId, lvl.locationId, lvl.available);
      fixed++;
    }
  }
  console.log(`Done. ${fixed} oversold level(s) ${DRY_RUN ? "to correct" : "corrected"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
