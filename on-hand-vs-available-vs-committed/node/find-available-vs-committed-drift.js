/**
 * Flag Shopify inventory levels where on hand, available, and committed do not add up.
 *
 * A lot of stock bugs come from treating on_hand as if it were sellable. The two are
 * not the same. Shopify tracks on_hand (physical count), committed (reserved by open
 * orders), and available (what a customer can actually buy). The identity that must
 * hold at every location is:
 *
 *   on_hand - committed - damaged - safety_stock = available
 *
 * When an app writes to the wrong bucket, or a manual adjustment only touches
 * on_hand, that identity breaks and the storefront can show stock that is not
 * really free, or hide stock that is. This reads each inventory item's quantities
 * at every location with the `quantities` field on InventoryLevel, works out the
 * expected available count, and tags the item for review with tagsAdd when the
 * drift is nonzero. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/on-hand-vs-available-vs-committed/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const REVIEW_TAG = process.env.REVIEW_TAG || "inventory-drift";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const QUANTITY_NAMES = ["available", "on_hand", "committed", "damaged", "safety_stock"];

export function quantitiesByName(level) {
  const out = Object.fromEntries(QUANTITY_NAMES.map((n) => [n, 0]));
  for (const q of level.quantities || []) {
    if (q.name in out) out[q.name] = q.quantity ?? 0;
  }
  return out;
}

export function driftForLevel(level) {
  const q = quantitiesByName(level);
  const expectedAvailable = q.on_hand - q.committed - q.damaged - q.safety_stock;
  return q.available - expectedAvailable;
}

export function levelsWithDrift(inventoryItem) {
  const out = [];
  for (const lvl of inventoryItem.inventoryLevels?.nodes || []) {
    const drift = driftForLevel(lvl);
    if (drift !== 0) {
      out.push({
        locationId: lvl.location?.id,
        locationName: lvl.location?.name,
        drift,
      });
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

const ITEMS_QUERY = `
query($cursor: String) {
  productVariants(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id sku
      inventoryItem {
        id
        tracked
        inventoryLevels(first: 20) {
          nodes {
            location { id name }
            quantities(names: ["available", "on_hand", "committed", "damaged", "safety_stock"]) {
              name quantity
            }
          }
        }
      }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* trackedVariants() {
  let cursor = null;
  while (true) {
    const data = (await gql(ITEMS_QUERY, { cursor })).productVariants;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function tagForReview(inventoryItemId, reviewTag) {
  const result = (await gql(TAGS_ADD, { id: inventoryItemId, tags: [reviewTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let flagged = 0;
  for await (const variant of trackedVariants()) {
    const item = variant.inventoryItem || {};
    if (item.tracked === false) continue;
    const drifts = levelsWithDrift(item);
    if (!drifts.length) continue;
    for (const d of drifts) {
      console.warn(
        `Variant ${variant.sku || variant.id} at ${d.locationName} is off by ${d.drift} units. ${DRY_RUN ? "would tag" : "tagging"}`
      );
    }
    if (!DRY_RUN) await tagForReview(item.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} item(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
