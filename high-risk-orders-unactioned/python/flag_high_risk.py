"""Flag high-risk Shopify orders that slipped through without review.

Shopify scores orders for fraud risk, but a HIGH risk order still ships if nobody
looks at it. This lists recent open orders, keeps the ones Shopify rated high risk
(or recommended to cancel) that are not already tagged, and adds a review tag with
tagsAdd so staff catch them before fulfillment. Run on a schedule. Safe to re-run.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("flag_high_risk")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
REVIEW_TAG = os.environ.get("REVIEW_TAG", "fraud-review")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ORDERS_QUERY = """
query($cursor: String) {
  orders(first: 25, after: $cursor, query: "fulfillment_status:unfulfilled AND -status:cancelled") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name cancelledAt tags
      risk { recommendation assessments { riskLevel } }
    }
  }
}"""

TAGS_ADD = """
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node { id }
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


def is_high_risk(order):
    risk = order.get("risk") or {}
    if risk.get("recommendation") == "CANCEL":
        return True
    return any(a.get("riskLevel") == "HIGH" for a in (risk.get("assessments") or []))


def needs_review(order, review_tag):
    if order.get("cancelledAt"):
        return False
    if review_tag in (order.get("tags") or []):
        return False
    return is_high_risk(order)


def tag_for_review(order_id, review_tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def open_orders():
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
    for order in open_orders():
        if not needs_review(order, REVIEW_TAG):
            continue
        log.warning("Order %s is high risk and unreviewed. %s",
                    order["name"], "would tag" if DRY_RUN else "tagging")
        if not DRY_RUN:
            tag_for_review(order["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d high-risk order(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
