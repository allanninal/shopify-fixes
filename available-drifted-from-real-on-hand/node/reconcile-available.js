/**
 * Reconcile Shopify Available inventory with a trusted real on-hand count.
 *
 * Reads a trusted count per SKU (a cycle count file or warehouse feed), compares
 * it to what Shopify currently reports as available at one location, and writes
 * the correction only when the drift is bigger than a tolerance. The write uses
 * inventorySetQuantities with compareQuantity, a compare-and-set guard, so a
 * concurrent sale or return cannot be silently overwritten.
 *
 * Guide: https://www.allanninal.dev/shopify/available-drifted-from-real-on-hand/
 * Run after every cycle count. Safe to run again and again.
 */
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOCATION_ID = process.env.SHOPIFY_LOCATION_ID || "gid://shopify/Location/0";
const DRIFT_TOLERANCE = Number(process.env.DRIFT_TOLERANCE || 1);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";
const COUNTS_FILE = process.env.REAL_COUNTS_FILE || "real_counts.csv";

/**
 * Return a write plan, or null if the two counts already agree.
 * Pure function, no I/O. realCount, shopifyAvailable, and tolerance are all
 * whole units (not cents, not fractional stock).
 */
export function planReconciliation(realCount, shopifyAvailable, tolerance) {
  if (realCount < 0 || shopifyAvailable < 0 || tolerance < 0) {
    throw new Error("counts and tolerance must not be negative");
  }
  const drift = realCount - shopifyAvailable;
  if (Math.abs(drift) <= tolerance) return null;
  return { quantity: realCount, compareQuantity: shopifyAvailable, drift };
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

const SET_QUANTITIES = `
mutation($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { changes { name delta quantityAfterChange } }
    userErrors { field message code }
  }
}`;

async function* shopifyLevels(locationId) {
  let cursor = null;
  while (true) {
    const data = (await gql(LEVELS_QUERY, { cursor, locationId })).location.inventoryLevels;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

function loadRealCounts(path) {
  const text = readFileSync(path, "utf8").trim();
  const [header, ...rows] = text.split("\n");
  const cols = header.split(",").map((c) => c.trim());
  const skuIdx = cols.indexOf("sku");
  const countIdx = cols.indexOf("real_count");
  const counts = {};
  for (const row of rows) {
    const cells = row.split(",");
    counts[cells[skuIdx].trim()] = parseInt(cells[countIdx].trim(), 10);
  }
  return counts;
}

async function applyCorrection(itemId, locationId, plan, reason = "correction") {
  const input = {
    name: "available",
    reason,
    ignoreCompareQuantity: false,
    quantities: [{
      inventoryItemId: itemId,
      locationId,
      quantity: plan.quantity,
      compareQuantity: plan.compareQuantity,
    }],
  };
  const result = (await gql(SET_QUANTITIES, { input })).inventorySetQuantities;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.inventoryAdjustmentGroup;
}

export async function run() {
  const realCounts = loadRealCounts(COUNTS_FILE);
  let fixed = 0;
  for await (const level of shopifyLevels(LOCATION_ID)) {
    const sku = level.item.sku;
    if (!(sku in realCounts)) continue;
    const shopifyAvailable = (level.quantities.find((q) => q.name === "available") || {}).quantity || 0;
    const plan = planReconciliation(realCounts[sku], shopifyAvailable, DRIFT_TOLERANCE);
    if (plan === null) continue;
    console.log(
      `SKU ${sku} drift ${plan.drift >= 0 ? "+" : ""}${plan.drift} (real ${realCounts[sku]}, available ${shopifyAvailable}). ${DRY_RUN ? "would correct" : "correcting"}`
    );
    if (!DRY_RUN) await applyCorrection(level.item.id, LOCATION_ID, plan);
    fixed++;
  }
  console.log(`Done. ${fixed} item(s) ${DRY_RUN ? "to correct" : "corrected"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
