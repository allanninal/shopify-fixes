"""Flag Shopify orders whose refund exists but the money never actually moved.

A refund record can sit on an order while the gateway transaction underneath it
failed, errored, or never left PENDING. This sums each refund's SUCCESS-only
transactions in minor units, compares that to the refund's own totalRefundedSet,
and tags the order for review with tagsAdd when they do not match. Read only
apart from the tag. Run on a schedule. Safe to run again and again.

Guide: https://www.allanninal.dev/shopify/refund-exists-but-the-money-never-moved/
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_stuck_refunds")

SHOP = os.environ.get("SHOPIFY_SHOP", "example.myshopify.com")
TOKEN = os.environ.get("SHOPIFY_ACCESS_TOKEN", "shpat_dummy")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "14"))
REVIEW_TAG = os.environ.get("REVIEW_TAG", "refund-stuck")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name tags
      refunds {
        id
        totalRefundedSet { shopMoney { amount currencyCode } }
        transactions(first: 10) {
          nodes { kind status amountSet { shopMoney { amount currencyCode } } }
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


def to_cents(amount):
    return round(float(amount) * 100)


def moved_cents(refund):
    """Sum of only the SUCCESS transactions on a refund, in minor units."""
    total = 0
    for t in (refund.get("transactions") or {}).get("nodes", []):
        if t.get("status") == "SUCCESS":
            total += to_cents(t["amountSet"]["shopMoney"]["amount"])
    return total


def is_stuck_refund(refund):
    claimed = to_cents(refund.get("totalRefundedSet", {}).get("shopMoney", {}).get("amount", "0"))
    return abs(moved_cents(refund) - claimed) > 1


def has_stuck_refund(order):
    return any(is_stuck_refund(r) for r in order.get("refunds") or [])


def tag_for_review(order_id, review_tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def refunded_orders():
    q = f"created_at:>-{LOOKBACK_DAYS}d AND financial_status:refunded OR financial_status:partially_refunded"
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
    for order in refunded_orders():
        if not has_stuck_refund(order):
            continue
        if REVIEW_TAG in (order.get("tags") or []):
            continue
        log.warning("Order %s has a refund that never moved the money. %s",
                    order["name"], "would tag" if DRY_RUN else "tagging")
        if not DRY_RUN:
            tag_for_review(order["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d order(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
