"""True up Shopify available inventory after a bad bulk import, safely.

A bad import (a bad CSV, a stuck sync app) can stamp the wrong "available"
quantity onto many items at once. This script reads a trusted snapshot (the
counts you captured before the bad import, keyed by SKU and location), reads
each item's live quantity from Shopify, and only corrects items where the
drift is real and inside a sane guard. It writes with inventorySetQuantities
using compareQuantity, so a sale that lands between the read and the write
is never silently overwritten. Batched, paged, and safe to run again and
again.
"""
import csv
import logging
import os
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("true_up_inventory")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

LOCATION_ID = os.environ.get("SHOPIFY_LOCATION_ID", "gid://shopify/Location/0")
SNAPSHOT_PATH = os.environ.get("SNAPSHOT_PATH", "snapshot.csv")
MAX_ADJUST = int(os.environ.get("MAX_ADJUST", "500"))
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "25"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

LOCATION_LEVELS_QUERY = """
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
}"""

SET_QUANTITIES_MUTATION = """
mutation($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { reason changes { name delta quantityAfterChange } }
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


def load_snapshot(path):
    """Read the trusted pre-import counts. Keyed by SKU, value is the correct
    available quantity. This is the source of truth, not what Shopify has now.
    """
    snapshot = {}
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            sku = (row.get("sku") or "").strip()
            if not sku:
                continue
            snapshot[sku] = int(row["available"])
    return snapshot


def plan_correction(sku, live_quantity, snapshot, max_adjust):
    """Pure decision: should this item be corrected, and to what?

    Returns a dict with the delta and target quantity when a correction is
    warranted, or None when the item should be left alone. An item is left
    alone when it is missing from the snapshot (we have no trusted value to
    restore), when it already matches, or when the drift is larger than
    max_adjust, since a swing that big is more likely a second bad file than
    real damage, and should go to a human instead of being auto-applied.
    """
    if sku not in snapshot:
        return None
    target = snapshot[sku]
    delta = target - live_quantity
    if delta == 0:
        return None
    if abs(delta) > max_adjust:
        return None
    return {"sku": sku, "from": live_quantity, "to": target, "delta": delta}


def batches(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def live_levels(location_id):
    cursor = None
    while True:
        data = gql(LOCATION_LEVELS_QUERY, {"id": location_id, "cursor": cursor})["location"]
        levels = data["inventoryLevels"]
        for node in levels["nodes"]:
            available = next(q["quantity"] for q in node["quantities"] if q["name"] == "available")
            yield node["item"]["id"], node["item"]["sku"], available
        if not levels["pageInfo"]["hasNextPage"]:
            return
        cursor = levels["pageInfo"]["endCursor"]


def apply_batch(location_id, corrections_by_item):
    """corrections_by_item: list of (inventory_item_id, live_quantity, target_quantity)."""
    quantities = [
        {
            "inventoryItemId": item_id,
            "locationId": location_id,
            "quantity": target,
            "compareQuantity": live_quantity,
        }
        for item_id, live_quantity, target in corrections_by_item
    ]
    result = gql(
        SET_QUANTITIES_MUTATION,
        {
            "input": {
                "name": "available",
                "reason": "correction",
                "ignoreCompareQuantity": False,
                "quantities": quantities,
            }
        },
    )["inventorySetQuantities"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["inventoryAdjustmentGroup"]


def run():
    snapshot = load_snapshot(SNAPSHOT_PATH)
    pending = []
    scanned = 0
    for item_id, sku, live_quantity in live_levels(LOCATION_ID):
        scanned += 1
        decision = plan_correction(sku, live_quantity, snapshot, MAX_ADJUST)
        if decision is None:
            continue
        log.info(
            "SKU %s drifted: %d -> %d (delta %+d). %s",
            sku, decision["from"], decision["to"], decision["delta"],
            "would fix" if DRY_RUN else "fixing",
        )
        pending.append((item_id, live_quantity, decision["to"]))

    fixed = 0
    if not DRY_RUN:
        for batch in batches(pending, BATCH_SIZE):
            apply_batch(LOCATION_ID, batch)
            fixed += len(batch)
            time.sleep(0.5)  # be gentle with the API between batches
    else:
        fixed = len(pending)

    log.info(
        "Done. Scanned %d item(s), %d %s.",
        scanned, fixed, "to correct" if DRY_RUN else "corrected",
    )


if __name__ == "__main__":
    run()
