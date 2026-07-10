"""Reconcile Shopify Available inventory with a trusted real on-hand count.

Reads a trusted count per SKU (a cycle count file or warehouse feed), compares
it to what Shopify currently reports as available at one location, and writes
the correction only when the drift is bigger than a tolerance. The write uses
inventorySetQuantities with compareQuantity, a compare-and-set guard, so a
concurrent sale or return cannot be silently overwritten.

Guide: https://www.allanninal.dev/shopify/available-drifted-from-real-on-hand/
Run after every cycle count. Safe to run again and again.
"""
import os
import csv
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("reconcile_available")

SHOP = os.environ.get("SHOPIFY_SHOP", "example.myshopify.com")
TOKEN = os.environ.get("SHOPIFY_ACCESS_TOKEN", "shpat_dummy")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOCATION_ID = os.environ.get("SHOPIFY_LOCATION_ID", "gid://shopify/Location/0")
DRIFT_TOLERANCE = int(os.environ.get("DRIFT_TOLERANCE", "1"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"
COUNTS_FILE = os.environ.get("REAL_COUNTS_FILE", "real_counts.csv")

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

SET_QUANTITIES = """
mutation($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { changes { name delta quantityAfterChange } }
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


def plan_reconciliation(real_count, shopify_available, tolerance):
    """Return a write plan, or None if the two counts already agree.

    Pure function, no I/O. real_count, shopify_available, and tolerance are
    all whole units (not cents, not fractional stock).
    """
    if real_count < 0 or shopify_available < 0 or tolerance < 0:
        raise ValueError("counts and tolerance must not be negative")
    drift = real_count - shopify_available
    if abs(drift) <= tolerance:
        return None
    return {
        "quantity": real_count,
        "compare_quantity": shopify_available,
        "drift": drift,
    }


def shopify_levels(location_id):
    cursor = None
    while True:
        data = gql(LEVELS_QUERY, {"cursor": cursor, "locationId": location_id})["location"]["inventoryLevels"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def load_real_counts(path):
    """CSV with columns: sku, real_count"""
    counts = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            counts[row["sku"]] = int(row["real_count"])
    return counts


def apply_correction(item_id, location_id, plan, reason="correction"):
    input_ = {
        "name": "available",
        "reason": reason,
        "ignoreCompareQuantity": False,
        "quantities": [{
            "inventoryItemId": item_id,
            "locationId": location_id,
            "quantity": plan["quantity"],
            "compareQuantity": plan["compare_quantity"],
        }],
    }
    result = gql(SET_QUANTITIES, {"input": input_})["inventorySetQuantities"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["inventoryAdjustmentGroup"]


def run():
    real_counts = load_real_counts(COUNTS_FILE)
    fixed = 0
    for level in shopify_levels(LOCATION_ID):
        sku = level["item"]["sku"]
        if sku not in real_counts:
            continue
        shopify_available = next(
            (q["quantity"] for q in level["quantities"] if q["name"] == "available"), 0
        )
        plan = plan_reconciliation(real_counts[sku], shopify_available, DRIFT_TOLERANCE)
        if plan is None:
            continue
        log.info(
            "SKU %s drift %+d (real %d, available %d). %s",
            sku, plan["drift"], real_counts[sku], shopify_available,
            "would correct" if DRY_RUN else "correcting",
        )
        if not DRY_RUN:
            apply_correction(level["item"]["id"], LOCATION_ID, plan)
        fixed += 1
    log.info("Done. %d item(s) %s.", fixed, "to correct" if DRY_RUN else "corrected")


if __name__ == "__main__":
    run()
