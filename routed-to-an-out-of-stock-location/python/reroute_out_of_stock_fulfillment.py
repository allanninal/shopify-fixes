"""Move Shopify fulfillment orders off a location that cannot stock them.

An order can land on a location that shows OPEN or IN_PROGRESS but has no
usable inventory for one or more line items there, often because a location
rule or the customer's address routed it there before a stock count caught
up. Shopify will not fulfill from a location with nothing to pick, so the
order stalls. This lists fulfillment orders assigned to a "problem" location,
asks Shopify which other locations could take the line items with
locationsForMove, picks the best candidate in pure code, and calls
fulfillmentOrderMove to reassign it. Read only apart from the move.
Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("reroute_out_of_stock_fulfillment")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
PROBLEM_LOCATION_ID = os.environ["OUT_OF_STOCK_LOCATION_ID"]
MOVABLE_STATUSES = {"OPEN", "IN_PROGRESS"}
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

FULFILLMENT_ORDERS_QUERY = """
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
}"""

MOVE_MUTATION = """
mutation($id: ID!, $newLocationId: ID!) {
  fulfillmentOrderMove(id: $id, newLocationId: $newLocationId) {
    movedFulfillmentOrder { id status }
    userErrors { field message }
  }
}"""


def gql(query, variables=None):
    r = requests.post(
        ENDPOINT,
        json={"query": query, "variables": variables or {}},
        headers={"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"},
        timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise RuntimeError(body["errors"])
    return body["data"]


def total_remaining(line_items):
    return sum(item.get("remainingQuantity", 0) for item in line_items or [])


def pick_reroute_location(fulfillment_order):
    """Pure decision: which location (if any) should this fulfillment order move to.

    Returns a candidate location id, or None if the order should be left alone.
    The order is only a candidate when it is still movable (OPEN or IN_PROGRESS)
    and it has unfulfilled line items. Among the locations Shopify reports with
    locationsForMove, we keep only the ones that can cover every remaining line
    item (no partial moves that would split the order in two), and we pick the
    one that covers the most remaining quantity so the busiest order clears
    first when several locations qualify.
    """
    if fulfillment_order.get("status") not in MOVABLE_STATUSES:
        return None

    needed = total_remaining(fulfillment_order.get("lineItems", {}).get("nodes"))
    if needed <= 0:
        return None

    best_id = None
    best_covered = -1
    for candidate in fulfillment_order.get("locationsForMove", {}).get("nodes", []):
        covered = total_remaining(candidate.get("availableLineItems", {}).get("nodes"))
        if covered < needed:
            continue
        if covered > best_covered:
            best_covered = covered
            best_id = candidate["location"]["id"]

    return best_id


def stuck_fulfillment_orders():
    cursor = None
    while True:
        data = gql(FULFILLMENT_ORDERS_QUERY, {"cursor": cursor, "locationId": PROBLEM_LOCATION_ID})
        location = data.get("location")
        if location is None:
            return
        page = location["fulfillmentOrders"]
        for node in page["nodes"]:
            yield node
        if not page["pageInfo"]["hasNextPage"]:
            return
        cursor = page["pageInfo"]["endCursor"]


def move_fulfillment_order(fulfillment_order_id, new_location_id):
    result = gql(MOVE_MUTATION, {"id": fulfillment_order_id, "newLocationId": new_location_id})["fulfillmentOrderMove"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["movedFulfillmentOrder"]["status"]


def run():
    moved = 0
    for fulfillment_order in stuck_fulfillment_orders():
        target = pick_reroute_location(fulfillment_order)
        if target is None:
            continue
        log.info(
            "Fulfillment order %s can move to %s. %s",
            fulfillment_order["id"], target, "would move" if DRY_RUN else "moving",
        )
        if not DRY_RUN:
            move_fulfillment_order(fulfillment_order["id"], target)
        moved += 1
    log.info("Done. %d fulfillment order(s) %s.", moved, "to move" if DRY_RUN else "moved")


if __name__ == "__main__":
    run()
