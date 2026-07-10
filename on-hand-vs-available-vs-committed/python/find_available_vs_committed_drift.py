"""Flag Shopify inventory levels where on hand, available, and committed do not add up.

A lot of stock bugs come from treating on_hand as if it were sellable. The two are
not the same. Shopify tracks on_hand (physical count), committed (reserved by open
orders), and available (what a customer can actually buy). The identity that must
hold at every location is:

    on_hand - committed - damaged - safety_stock = available

When an app writes to the wrong bucket, or a manual adjustment only touches
on_hand, that identity breaks and the storefront can show stock that is not
really free, or hide stock that is. This reads each inventory item's quantities at
every location with the `quantities` field on InventoryLevel, works out the
expected available count in whole units (inventory counts are already integers,
so no minor-unit math is needed here), and tags the item for review with
tagsAdd when the drift is nonzero. Read only apart from the tag.
Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_available_vs_committed_drift")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
REVIEW_TAG = os.environ.get("REVIEW_TAG", "inventory-drift")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

QUANTITY_NAMES = ["available", "on_hand", "committed", "damaged", "safety_stock"]

ITEMS_QUERY = """
query($cursor: String) {
  productVariants(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id sku
      inventoryItem {
        id
        tracked
        variant { product { tags } }
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
}"""

TAGS_ADD = """
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
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


def quantities_by_name(level):
    """Turn the quantities list Shopify returns into a plain dict, missing names as 0."""
    out = {name: 0 for name in QUANTITY_NAMES}
    for q in level.get("quantities") or []:
        if q.get("name") in out:
            out[q["name"]] = q.get("quantity", 0)
    return out


def drift_for_level(level):
    """Return the gap between the available Shopify reports and the available the
    other buckets imply. Zero means the level ties out. Nonzero means something
    wrote to on_hand, committed, damaged, or safety_stock without available
    following, so the storefront number cannot be trusted.
    """
    q = quantities_by_name(level)
    expected_available = q["on_hand"] - q["committed"] - q["damaged"] - q["safety_stock"]
    return q["available"] - expected_available


def levels_with_drift(inventory_item):
    """Return the locations on this inventory item where the drift is nonzero."""
    out = []
    for lvl in (inventory_item.get("inventoryLevels") or {}).get("nodes") or []:
        drift = drift_for_level(lvl)
        if drift != 0:
            out.append({
                "locationId": (lvl.get("location") or {}).get("id"),
                "locationName": (lvl.get("location") or {}).get("name"),
                "drift": drift,
            })
    return out


def tag_for_review(inventory_item_id, review_tag):
    result = gql(TAGS_ADD, {"id": inventory_item_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def tracked_variants():
    cursor = None
    while True:
        data = gql(ITEMS_QUERY, {"cursor": cursor})["productVariants"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    flagged = 0
    for variant in tracked_variants():
        item = variant.get("inventoryItem") or {}
        if not item.get("tracked", True):
            continue
        drifts = levels_with_drift(item)
        if not drifts:
            continue
        for d in drifts:
            log.warning(
                "Variant %s at %s is off by %s units. %s",
                variant.get("sku") or variant["id"], d["locationName"], d["drift"],
                "would tag" if DRY_RUN else "tagging",
            )
        if not DRY_RUN:
            tag_for_review(item["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d item(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
