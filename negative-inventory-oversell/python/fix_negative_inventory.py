"""Find and correct Shopify variants that oversold into negative inventory.

When the inventory policy allows selling past zero (CONTINUE), a burst of orders can
drive a location's available count below zero. Negative stock skews reports and
reorder math. This lists variants, finds locations where available is negative, and
sets them back to zero with inventorySetQuantities using compareQuantity so a
concurrent change is not clobbered. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("fix_negative_inventory")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

VARIANTS_QUERY = """
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
}"""

SET_MUTATION = """
mutation($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { id }
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


def available_of(level):
    for q in level.get("quantities") or []:
        if q.get("name") == "available":
            return q.get("quantity")
    return None


def oversold_levels(variant):
    """Return the locations where available is negative, with the values to correct."""
    out = []
    item = variant.get("inventoryItem") or {}
    for lvl in ((item.get("inventoryLevels") or {}).get("nodes") or []):
        avail = available_of(lvl)
        if avail is not None and avail < 0:
            out.append({
                "inventoryItemId": item.get("id"),
                "locationId": (lvl.get("location") or {}).get("id"),
                "available": avail,
            })
    return out


def correct(inventory_item_id, location_id, current):
    result = gql(SET_MUTATION, {"input": {
        "name": "available",
        "reason": "correction",
        "ignoreCompareQuantity": False,
        "quantities": [{
            "inventoryItemId": inventory_item_id,
            "locationId": location_id,
            "quantity": 0,
            "compareQuantity": current,
        }],
    }})["inventorySetQuantities"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def oversold_variants():
    cursor = None
    while True:
        data = gql(VARIANTS_QUERY, {"cursor": cursor})["productVariants"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    fixed = 0
    for variant in oversold_variants():
        for lvl in oversold_levels(variant):
            log.warning("Variant %s at %s is %s. %s", variant.get("sku") or variant["id"],
                        lvl["locationId"], lvl["available"], "would set to 0" if DRY_RUN else "setting to 0")
            if not DRY_RUN:
                correct(lvl["inventoryItemId"], lvl["locationId"], lvl["available"])
            fixed += 1
    log.info("Done. %d oversold level(s) %s.", fixed, "to correct" if DRY_RUN else "corrected")


if __name__ == "__main__":
    run()
