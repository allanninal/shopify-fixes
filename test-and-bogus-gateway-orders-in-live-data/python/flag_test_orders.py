"""Flag Shopify test and Bogus Gateway orders that leaked into live reporting.

Every order placed with Shopify's own test mode, or paid through the Bogus
Gateway used in development stores and checkout QA, carries a `test` flag set
to true. Those orders are not real sales, but they still show up in the
Orders list, in exports, and in anything that reads the Admin API without
checking that flag. This walks recent orders, decides which ones are test or
bogus-gateway orders with a pure function, and tags the ones that are not
already tagged so reports and automations can filter them out. It never
deletes or cancels an order. Read and tag only. Run on a schedule. Safe to
run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("flag_test_orders")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
REVIEW_TAG = os.environ.get("TEST_ORDER_TAG", "test-order")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

BOGUS_GATEWAYS = {"bogus", "bogus_gateway"}

ORDERS_QUERY = """
query($cursor: String) {
  orders(first: 50, after: $cursor, query: "created_at:>-30d") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name test tags
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      transactions(first: 10) { gateway }
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


def uses_bogus_gateway(transactions):
    for t in transactions or []:
        gateway = (t.get("gateway") or "").lower()
        if gateway in BOGUS_GATEWAYS:
            return True
    return False


def is_test_order(order):
    """True when an order should be treated as test data, not a live sale."""
    if order.get("test"):
        return True
    return uses_bogus_gateway(order.get("transactions"))


def needs_tag(order, review_tag):
    if not is_test_order(order):
        return False
    return review_tag not in (order.get("tags") or [])


def tag_as_test(order_id, review_tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def recent_orders():
    cursor = None
    while True:
        data = gql(ORDERS_QUERY, {"cursor": cursor})["orders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    flagged = 0
    leaked_cents = 0
    for order in recent_orders():
        if not is_test_order(order):
            continue
        amount = (order.get("currentTotalPriceSet") or {}).get("shopMoney", {}).get("amount", "0")
        leaked_cents += to_cents(amount)
        if not needs_tag(order, REVIEW_TAG):
            continue
        log.warning("Order %s is test or bogus-gateway data. %s",
                    order["name"], "would tag" if DRY_RUN else "tagging")
        if not DRY_RUN:
            tag_as_test(order["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d order(s) %s. %.2f in test money seen in the window.",
              flagged, "to tag" if DRY_RUN else "tagged", leaked_cents / 100)


if __name__ == "__main__":
    run()
