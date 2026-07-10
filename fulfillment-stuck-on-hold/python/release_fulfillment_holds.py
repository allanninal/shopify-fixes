"""Release Shopify fulfillment holds that were never cleaned up.

A fulfillment order can be put on hold for a real reason (fraud review, an
address problem, waiting on stock) and that reason gets fixed, but nothing
ever calls fulfillmentOrderReleaseHold, so the order sits at status ON_HOLD
forever. This job pages through manualHoldsFulfillmentOrders, keeps only the
holds this app itself applied whose reason is one we are allowed to clear on
our own, and only on orders a human has tagged as resolved, then releases
those specific hold ids with fulfillmentOrderReleaseHold. It never releases a
hold it does not recognize, and it never releases every hold on an order
blindly. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("release_fulfillment_holds")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
RESOLVED_TAG = os.environ.get("HOLD_RESOLVED_TAG", "hold-resolved")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

# Reasons this job is allowed to clear on its own, once a human has tagged the
# order resolved. High risk of fraud is left out on purpose: that call always
# needs a person, never a script.
RELEASABLE_REASONS = {
    "INVENTORY_OUT_OF_STOCK",
    "INCORRECT_ADDRESS",
    "AWAITING_PAYMENT",
    "AWAITING_RETURN_ITEMS",
    "UNKNOWN_DELIVERY_DATE",
    "ONLINE_STORE_POST_PURCHASE_CROSS_SELL",
    "OTHER",
}

HELD_ORDERS_QUERY = """
query($cursor: String) {
  manualHoldsFulfillmentOrders(first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      status
      order { id name tags }
      fulfillmentHolds {
        id
        reason
        reasonNotes
        heldByRequestingApp
      }
    }
  }
}"""

RELEASE_MUTATION = """
mutation($id: ID!, $holdIds: [ID!]) {
  fulfillmentOrderReleaseHold(id: $id, holdIds: $holdIds) {
    fulfillmentOrder { id status }
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


def holds_to_release(fulfillment_order, resolved_tag):
    """Pure decision: which hold ids on this fulfillment order are safe to release.

    Only holds this app applied itself (heldByRequestingApp) count, only when
    the reason is in RELEASABLE_REASONS, and only when the order carries the
    confirmation tag a human adds once the underlying problem is actually
    fixed. Everything else is left alone for a person to release by hand.
    """
    if fulfillment_order.get("status") != "ON_HOLD":
        return []
    order = fulfillment_order.get("order") or {}
    if resolved_tag not in (order.get("tags") or []):
        return []
    ids = []
    for hold in fulfillment_order.get("fulfillmentHolds") or []:
        if not hold.get("heldByRequestingApp"):
            continue
        if hold.get("reason") not in RELEASABLE_REASONS:
            continue
        ids.append(hold["id"])
    return ids


def held_fulfillment_orders():
    cursor = None
    while True:
        data = gql(HELD_ORDERS_QUERY, {"cursor": cursor})["manualHoldsFulfillmentOrders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def release_holds(fulfillment_order_id, hold_ids):
    result = gql(RELEASE_MUTATION, {"id": fulfillment_order_id, "holdIds": hold_ids})[
        "fulfillmentOrderReleaseHold"
    ]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["fulfillmentOrder"]["status"]


def run():
    released = 0
    for fo in held_fulfillment_orders():
        hold_ids = holds_to_release(fo, RESOLVED_TAG)
        if not hold_ids:
            continue
        order_name = (fo.get("order") or {}).get("name", fo["id"])
        log.info(
            "Fulfillment order %s has %d releasable hold(s). %s",
            order_name, len(hold_ids), "would release" if DRY_RUN else "releasing",
        )
        if not DRY_RUN:
            release_holds(fo["id"], hold_ids)
        released += 1
    log.info("Done. %d fulfillment order(s) %s.", released, "to release" if DRY_RUN else "released")


if __name__ == "__main__":
    run()
