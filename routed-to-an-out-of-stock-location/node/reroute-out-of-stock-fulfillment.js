/**
 * Move Shopify fulfillment orders off a location that cannot stock them.
 *
 * An order can land on a location that shows OPEN or IN_PROGRESS but has no
 * usable inventory for one or more line items there, often because a location
 * rule or the customer's address routed it there before a stock count caught
 * up. Shopify will not fulfill from a location with nothing to pick, so the
 * order stalls. This lists fulfillment orders assigned to a "problem"
 * location, asks Shopify which other locations could take the line items
 * with locationsForMove, picks the best candidate in pure code, and calls
 * fulfillmentOrderMove to reassign it. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/routed-to-an-out-of-stock-location/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const PROBLEM_LOCATION_ID = process.env.OUT_OF_STOCK_LOCATION_ID || "gid://shopify/Location/1";
const MOVABLE_STATUSES = new Set(["OPEN", "IN_PROGRESS"]);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function totalRemaining(lineItems) {
  return (lineItems || []).reduce((sum, item) => sum + (item.remainingQuantity || 0), 0);
}

/**
 * Pure decision: which location (if any) should this fulfillment order move to.
 *
 * Returns a candidate location id, or null if the order should be left alone.
 * The order is only a candidate when it is still movable (OPEN or IN_PROGRESS)
 * and it has unfulfilled line items. Among the locations Shopify reports with
 * locationsForMove, we keep only the ones that can cover every remaining line
 * item (no partial moves that would split the order in two), and we pick the
 * one that covers the most remaining quantity so the busiest order clears
 * first when several locations qualify.
 */
export function pickRerouteLocation(fulfillmentOrder) {
  if (!MOVABLE_STATUSES.has(fulfillmentOrder.status)) return null;

  const needed = totalRemaining(fulfillmentOrder.lineItems?.nodes);
  if (needed <= 0) return null;

  let bestId = null;
  let bestCovered = -1;
  for (const candidate of fulfillmentOrder.locationsForMove?.nodes || []) {
    const covered = totalRemaining(candidate.availableLineItems?.nodes);
    if (covered < needed) continue;
    if (covered > bestCovered) {
      bestCovered = covered;
      bestId = candidate.location.id;
    }
  }
  return bestId;
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

const FULFILLMENT_ORDERS_QUERY = `
query($cursor: String, $locationId: ID!) {
  location(id: $locationId) {
    fulfillmentOrders(first: 25, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        status
        lineItems(first: 50) { nodes { id remainingQuantity } }
        locationsForMove(first: 10) {
          nodes {
            location { id name }
            message
            availableLineItems(first: 50) { nodes { id remainingQuantity } }
          }
        }
      }
    }
  }
}`;

const MOVE_MUTATION = `
mutation($id: ID!, $newLocationId: ID!) {
  fulfillmentOrderMove(id: $id, newLocationId: $newLocationId) {
    movedFulfillmentOrder { id status }
    userErrors { field message }
  }
}`;

async function* stuckFulfillmentOrders() {
  let cursor = null;
  while (true) {
    const data = await gql(FULFILLMENT_ORDERS_QUERY, { cursor, locationId: PROBLEM_LOCATION_ID });
    const location = data.location;
    if (!location) return;
    const page = location.fulfillmentOrders;
    for (const node of page.nodes) yield node;
    if (!page.pageInfo.hasNextPage) return;
    cursor = page.pageInfo.endCursor;
  }
}

async function moveFulfillmentOrder(fulfillmentOrderId, newLocationId) {
  const result = (await gql(MOVE_MUTATION, { id: fulfillmentOrderId, newLocationId })).fulfillmentOrderMove;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.movedFulfillmentOrder.status;
}

export async function run() {
  let moved = 0;
  for await (const fulfillmentOrder of stuckFulfillmentOrders()) {
    const target = pickRerouteLocation(fulfillmentOrder);
    if (!target) continue;
    console.log(`Fulfillment order ${fulfillmentOrder.id} can move to ${target}. ${DRY_RUN ? "would move" : "moving"}`);
    if (!DRY_RUN) await moveFulfillmentOrder(fulfillmentOrder.id, target);
    moved++;
  }
  console.log(`Done. ${moved} fulfillment order(s) ${DRY_RUN ? "to move" : "moved"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
