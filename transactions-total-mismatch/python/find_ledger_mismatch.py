"""Flag Shopify orders whose transactions do not add up to what was received.

The money on an order should tie out: captures minus refunds equals the amount
received. When they drift apart (a failed refund still counted, a gateway hiccup,
a manual edit), the order's ledger is wrong and reports quietly lie. This sums each
recent order's successful transactions, compares them to totalReceivedSet, and tags
the ones that do not match for review with tagsAdd. Read only apart from the tag.
Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_ledger_mismatch")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "7"))
REVIEW_TAG = os.environ.get("REVIEW_TAG", "ledger-mismatch")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CHARGE_KINDS = {"SALE", "CAPTURE"}

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name tags
      totalReceivedSet { shopMoney { amount currencyCode } }
      transactions(first: 30) {
        id kind status
        amountSet { shopMoney { amount currencyCode } }
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


def net_captured_cents(transactions):
    """Successful captures minus successful refunds, in minor units."""
    total = 0
    for t in transactions or []:
        if t.get("status") != "SUCCESS":
            continue
        amount = to_cents(t["amountSet"]["shopMoney"]["amount"])
        if t.get("kind") in CHARGE_KINDS:
            total += amount
        elif t.get("kind") == "REFUND":
            total -= amount
    return total


def is_mismatch(order):
    received = to_cents((order.get("totalReceivedSet") or {}).get("shopMoney", {}).get("amount", "0"))
    return abs(net_captured_cents(order.get("transactions")) - received) > 1


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
        if not is_mismatch(order):
            continue
        if REVIEW_TAG in (order.get("tags") or []):
            continue
        log.warning("Order %s ledger does not tie out. %s",
                    order["name"], "would tag" if DRY_RUN else "tagging")
        if not DRY_RUN:
            tag_for_review(order["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d order(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
