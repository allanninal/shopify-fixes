"""Flag Shopify fulfillment orders the 3PL already shipped but Shopify still shows open.

A third-party warehouse ships the box and hands the carrier a tracking number, but the
webhook or API call that was supposed to tell Shopify "this is done" never lands, or it
lands and silently fails. The result: a Fulfillment record exists with status SUCCESS
and real tracking info, yet the parent FulfillmentOrder is still IN_PROGRESS or OPEN.
Shopify keeps waving at the merchant to fulfill an order that is already on a truck.

This job walks recent orders, looks at each fulfillment order together with the
fulfillments attached to it, and tags for review the ones where the warehouse has
clearly finished the job but Shopify has not caught up. It never forces a fulfillment
order closed itself, since that transition belongs to the fulfillment service app that
accepted the request. Tagging is the safe, universally permitted action, and a human
or the 3PL's own reconciliation job can move or close the order once flagged.
Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("flag_fulfillment_out_of_sync")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "14"))
REVIEW_TAG = os.environ.get("REVIEW_TAG", "3pl-out-of-sync")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

OPEN_FULFILLMENT_ORDER_STATUSES = {"IN_PROGRESS", "OPEN"}

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      tags
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
          fulfillments(first: 10) {
            nodes {
              id
              status
              trackingInfo(first: 5) { company number url }
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


def has_shipped_tracking(fulfillment):
    """A fulfillment counts as shipped when the 3PL reported success with a real tracking number."""
    if fulfillment.get("status") != "SUCCESS":
        return False
    tracking = fulfillment.get("trackingInfo") or []
    return any((t.get("number") or "").strip() for t in tracking)


def fulfillment_order_out_of_sync(fulfillment_order):
    """Pure decision: does this fulfillment order look stuck while the 3PL already shipped it?

    True only when Shopify still reports the fulfillment order as IN_PROGRESS or OPEN,
    and at least one linked fulfillment already succeeded with tracking attached.
    """
    if fulfillment_order.get("status") not in OPEN_FULFILLMENT_ORDER_STATUSES:
        return False
    fulfillments = (fulfillment_order.get("fulfillments") or {}).get("nodes") or []
    return any(has_shipped_tracking(f) for f in fulfillments)


def order_needs_review(order):
    """An order needs review when any of its fulfillment orders is out of sync."""
    fulfillment_orders = (order.get("fulfillmentOrders") or {}).get("nodes") or []
    return any(fulfillment_order_out_of_sync(fo) for fo in fulfillment_orders)


def tag_for_review(order_id, review_tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def recent_orders():
    q = f"created_at:>-{LOOKBACK_DAYS}d"
    cursor = None
    while True:
        data = gql(ORDERS_QUERY, {"cursor": cursor, "q": q})["orders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    flagged = 0
    for order in recent_orders():
        if not order_needs_review(order):
            continue
        if REVIEW_TAG in (order.get("tags") or []):
            continue
        log.warning("Order %s has a shipped fulfillment order still open. %s",
                    order["name"], "would tag" if DRY_RUN else "tagging")
        if not DRY_RUN:
            tag_for_review(order["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d order(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
