"""Turn inventory tracking back on for Shopify variants that sell without limit.

A variant with inventoryItem.tracked set to false has no quantity behind it, so
it never runs out no matter how many orders come in. Some untracked variants are
meant to be that way, like services or digital goods, so this only turns tracking
on for variants that are untracked, have real recent sales, and carry a confirmation
tag you add once you have reviewed them. Read only apart from the tracking flip.
Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("fix_untracked_items")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
TRACK_TAG = os.environ.get("TRACK_FIX_TAG", "track-me")
MIN_RECENT_SALES = int(os.environ.get("MIN_RECENT_SALES", "1"))
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "30"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

VARIANTS_QUERY = """
query($cursor: String) {
  productVariants(first: 50, after: $cursor, query: "inventory_total:0") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      product { tags }
      inventoryItem { id tracked }
    }
  }
}"""

RECENT_ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 50, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      lineItems(first: 50) {
        nodes { quantity variant { id } }
      }
    }
  }
}"""

TRACK_MUTATION = """
mutation($id: ID!, $input: InventoryItemInput!) {
  inventoryItemUpdate(id: $id, input: $input) {
    inventoryItem { id tracked }
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


def eligible_to_track(variant, recent_sales, required_tag, min_sales=1):
    """Pure decision: should this variant have tracking turned on?

    True only when the inventory item is currently untracked, it has sold at
    least ``min_sales`` units in the lookback window, and the product carries
    the confirmation tag a human adds once they have reviewed it.
    """
    inventory_item = variant.get("inventoryItem") or {}
    if inventory_item.get("tracked"):
        return False
    if recent_sales < min_sales:
        return False
    tags = (variant.get("product") or {}).get("tags") or []
    return required_tag in tags


def candidate_variants():
    cursor = None
    while True:
        data = gql(VARIANTS_QUERY, {"cursor": cursor})["productVariants"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def recent_sales_count(variant_id, lookback_days):
    """Units of this variant sold in the lookback window, from recent orders."""
    q = f"created_at:>-{lookback_days}d"
    cursor = None
    total = 0
    while True:
        data = gql(RECENT_ORDERS_QUERY, {"cursor": cursor, "q": q})["orders"]
        for order in data["nodes"]:
            for item in order["lineItems"]["nodes"]:
                if item.get("variant", {}).get("id") == variant_id:
                    total += item["quantity"]
        if not data["pageInfo"]["hasNextPage"]:
            return total
        cursor = data["pageInfo"]["endCursor"]


def turn_tracking_on(inventory_item_id):
    result = gql(TRACK_MUTATION, {"id": inventory_item_id, "input": {"tracked": True}})["inventoryItemUpdate"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["inventoryItem"]["tracked"]


def run():
    fixed = 0
    for variant in candidate_variants():
        sales = recent_sales_count(variant["id"], LOOKBACK_DAYS)
        if not eligible_to_track(variant, sales, TRACK_TAG, MIN_RECENT_SALES):
            continue
        log.info("Variant %s untracked with %d recent sales. %s",
                  variant["id"], sales, "would turn tracking on" if DRY_RUN else "turning tracking on")
        if not DRY_RUN:
            turn_tracking_on(variant["inventoryItem"]["id"])
        fixed += 1
    log.info("Done. %d variant(s) %s.", fixed, "to fix" if DRY_RUN else "fixed")


if __name__ == "__main__":
    run()
