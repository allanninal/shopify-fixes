"""Reconcile Shopify inventory without racing other writers.

Two writers, such as a checkout and a warehouse sync, can each read the same
available quantity and then both write a new absolute value back. Whichever
write lands last wins completely and silently erases the other one, so the
store oversells. This script reads the live available quantity right before
writing and passes it as compareQuantity on inventorySetQuantities, so Shopify
rejects the write instead of silently overwriting a change made in between.
Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("reconcile_inventory")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOCATION_ID = os.environ["LOCATION_ID"]
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

LEVELS_QUERY = """
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
}"""

SET_QUANTITIES_MUTATION = """
mutation($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { createdAt }
    userErrors { field message code }
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


def available_quantity(node):
    """Pure. Pull the 'available' quantity out of a quantities list."""
    for q in node.get("quantities") or []:
        if q.get("name") == "available":
            return q.get("quantity")
    return None


def plan_write(item_id, location_id, current_available, correct_available):
    """Pure. Return the inventorySetQuantities write to send, or None if nothing to fix.

    current_available must be read immediately before this call, never cached,
    so compareQuantity always reflects the true live value at write time. That
    is what lets Shopify reject a write when another process already changed
    the count, instead of silently overwriting it.
    """
    if current_available == correct_available:
        return None
    return {
        "name": "available",
        "reason": "correction",
        "ignoreCompareQuantityFailures": False,
        "quantities": [{
            "inventoryItemId": item_id,
            "locationId": location_id,
            "quantity": correct_available,
            "compareQuantity": current_available,
        }],
    }


def inventory_levels(location_id):
    cursor = None
    while True:
        loc = gql(LEVELS_QUERY, {"cursor": cursor, "locationId": location_id})["location"]
        data = loc["inventoryLevels"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def apply_write(write):
    result = gql(SET_QUANTITIES_MUTATION, {"input": write})["inventorySetQuantities"]
    errors = result["userErrors"]
    if errors:
        stale = any(e.get("code") == "COMPARE_QUANTITY_STALE" for e in errors)
        if stale:
            return "stale"
        raise RuntimeError(errors)
    return "applied"


def correct_quantity_for(sku):
    """Look up the truth for this SKU, for example a warehouse feed or a fresh count.
    Replace this with your own source of correct stock before running for real.
    """
    raise NotImplementedError


def run():
    corrected = 0
    stale = 0
    for node in inventory_levels(LOCATION_ID):
        item_id = node["item"]["id"]
        sku = node["item"]["sku"]
        current = available_quantity(node)
        if current is None:
            continue
        correct = correct_quantity_for(sku)
        write = plan_write(item_id, LOCATION_ID, current, correct)
        if write is None:
            continue
        log.info("SKU %s: %s -> %s. %s", sku, current, correct,
                  "would write" if DRY_RUN else "writing")
        if not DRY_RUN:
            outcome = apply_write(write)
            if outcome == "stale":
                stale += 1
                log.warning("SKU %s: compareQuantity stale, another write landed first. Skipping this pass.", sku)
                continue
        corrected += 1
    log.info("Done. %d item(s) %s, %d rejected as stale.",
              corrected, "to correct" if DRY_RUN else "corrected", stale)


if __name__ == "__main__":
    run()
