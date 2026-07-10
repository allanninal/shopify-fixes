"""Flag Shopify orders that are paid but still unfulfilled past your shipping SLA.

A paid order that sits unfulfilled for days is a late shipment waiting to happen, but
nothing surfaces it on its own. This lists paid, unfulfilled, not-cancelled orders,
keeps the ones older than your SLA that are not on hold, and tags them for review with
tagsAdd so the team can catch them before the customer complains. Only write is the tag.
Run on a schedule. Safe to run again and again.
"""
import os
import time
import logging
import datetime
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("flag_stale_unfulfilled")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
SLA_DAYS = float(os.environ.get("SLA_DAYS", "3"))
REVIEW_TAG = os.environ.get("REVIEW_TAG", "fulfillment-overdue")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ORDERS_QUERY = """
query($cursor: String) {
  orders(first: 25, after: $cursor,
         query: "financial_status:paid AND fulfillment_status:unfulfilled AND -status:cancelled") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt displayFulfillmentStatus tags
      fulfillmentOrders(first: 10) { nodes { status } }
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


def iso_to_epoch(iso):
    return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def is_on_hold(order):
    nodes = ((order.get("fulfillmentOrders") or {}).get("nodes")) or []
    return any(fo.get("status") == "ON_HOLD" for fo in nodes)


def is_stale_unfulfilled(order, now_epoch, sla_days, review_tag):
    if order.get("displayFulfillmentStatus") != "UNFULFILLED":
        return False
    if review_tag in (order.get("tags") or []):
        return False
    if is_on_hold(order):
        return False
    created = order.get("createdAt")
    if not created:
        return False
    age_days = (now_epoch - iso_to_epoch(created)) / 86400
    return age_days >= sla_days


def tag_for_review(order_id, review_tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def unfulfilled_orders():
    cursor = None
    while True:
        data = gql(ORDERS_QUERY, {"cursor": cursor})["orders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    now_epoch = time.time()
    flagged = 0
    for order in unfulfilled_orders():
        if not is_stale_unfulfilled(order, now_epoch, SLA_DAYS, REVIEW_TAG):
            continue
        log.warning("Order %s unfulfilled past SLA. %s", order["name"],
                    "would tag" if DRY_RUN else "tagging")
        if not DRY_RUN:
            tag_for_review(order["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d overdue order(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
