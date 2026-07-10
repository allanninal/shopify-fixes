/**
 * True up Shopify available inventory after a bad bulk import, safely.
 *
 * A bad import (a bad CSV, a stuck sync app) can stamp the wrong "available"
 * quantity onto many items at once. This script reads a trusted snapshot (the
 * counts you captured before the bad import, keyed by SKU and location), reads
 * each item's live quantity from Shopify, and only corrects items where the
 * drift is real and inside a sane guard. It writes with inventorySetQuantities
 * using compareQuantity, so a sale that lands between the read and the write
 * is never silently overwritten. Batched, paged, and safe to run again and
 * again.
 *
 * Guide: https://www.allanninal.dev/shopify/bulk-stock-true-up-after-a-bad-import/
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

const LOCATION_ID = process.env.SHOPIFY_LOCATION_ID || "gid://shopify/Location/0";
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH || "snapshot.csv";
const MAX_ADJUST = Number(process.env.MAX_ADJUST || 500);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 25);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

/**
 * Pure decision: should this item be corrected, and to what?
 *
 * Returns an object with the delta and target quantity when a correction is
 * warranted, or null when the item should be left alone. An item is left
 * alone when it is missing from the snapshot (no trusted value to restore),
 * when it already matches, or when the drift is larger than maxAdjust, since
 * a swing that big is more likely a second bad file than real damage, and
 * should go to a human instead of being auto-applied.
 */
export function planCorrection(sku, liveQuantity, snapshot, maxAdjust) {
  if (!(sku in snapshot)) return null;
  const target = snapshot[sku];
  const delta = target - liveQuantity;
  if (delta === 0) return null;
  if (Math.abs(delta) > maxAdjust) return null;
  return { sku, from: liveQuantity, to: target, delta };
}

/** Read the trusted pre-import counts from a small CSV: sku,available */
export function loadSnapshot(text) {
  const snapshot = {};
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const [header, ...rows] = lines;
  const cols = header.split(",").map((c) => c.trim().toLowerCase());
  const skuIdx = cols.indexOf("sku");
  const availIdx = cols.indexOf("available");
  for (const line of rows) {
    const cells = line.split(",");
    const sku = (cells[skuIdx] || "").trim();
    if (!sku) continue;
    snapshot[sku] = parseInt(cells[availIdx], 10);
  }
  return snapshot;
}

export function batches(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
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

const LOCATION_LEVELS_QUERY = `
query($id: ID!, $cursor: String) {
  location(id: $id) {
    inventoryLevels(first: 100, after: $cursor) {
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
    inventoryAdjustmentGroup { reason changes { name delta quantityAfterChange } }
    userErrors { field message }
  }
}`;

async function* liveLevels(locationId) {
  let cursor = null;
  while (true) {
    const data = (await gql(LOCATION_LEVELS_QUERY, { id: locationId, cursor })).location;
    const levels = data.inventoryLevels;
    for (const node of levels.nodes) {
      const available = node.quantities.find((q) => q.name === "available").quantity;
      yield { itemId: node.item.id, sku: node.item.sku, available };
    }
    if (!levels.pageInfo.hasNextPage) return;
    cursor = levels.pageInfo.endCursor;
  }
}

async function applyBatch(locationId, corrections) {
  const quantities = corrections.map(({ itemId, liveQuantity, target }) => ({
    inventoryItemId: itemId,
    locationId,
    quantity: target,
    compareQuantity: liveQuantity,
  }));
  const result = (
    await gql(SET_QUANTITIES_MUTATION, {
      input: { name: "available", reason: "correction", ignoreCompareQuantity: false, quantities },
    })
  ).inventorySetQuantities;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.inventoryAdjustmentGroup;
}

export async function run() {
  const snapshot = loadSnapshot(readFileSync(SNAPSHOT_PATH, "utf-8"));
  const pending = [];
  let scanned = 0;

  for await (const { itemId, sku, available } of liveLevels(LOCATION_ID)) {
    scanned++;
    const decision = planCorrection(sku, available, snapshot, MAX_ADJUST);
    if (!decision) continue;
    console.log(
      `SKU ${sku} drifted: ${decision.from} -> ${decision.to} (delta ${decision.delta > 0 ? "+" : ""}${decision.delta}). ${DRY_RUN ? "would fix" : "fixing"}`,
    );
    pending.push({ itemId, liveQuantity: available, target: decision.to });
  }

  let fixed = 0;
  if (!DRY_RUN) {
    for (const batch of batches(pending, BATCH_SIZE)) {
      await applyBatch(LOCATION_ID, batch);
      fixed += batch.length;
      await new Promise((r) => setTimeout(r, 500)); // be gentle with the API between batches
    }
  } else {
    fixed = pending.length;
  }

  console.log(`Done. Scanned ${scanned} item(s), ${fixed} ${DRY_RUN ? "to correct" : "corrected"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
