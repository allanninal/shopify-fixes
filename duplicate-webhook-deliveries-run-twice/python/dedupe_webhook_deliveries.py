"""Detect and repair Shopify orders that were double-processed by a duplicate webhook delivery.

Shopify retries a webhook when your endpoint is slow or returns a non-2xx status, and the
same delivery can also arrive twice over the network. Every delivery carries a unique
X-Shopify-Webhook-Id header. If a handler does not check that id before acting, a retried
"orders/paid" delivery can double-apply a side effect, such as granting store credit twice.

This script does not sit in the webhook path. It reconciles after the fact: it reads the
ledger of processed webhook ids each handler is expected to stamp onto the order (as tags
in the form wh-<webhook id>), finds orders where the same webhook id shows up more than
once, and tags those orders for review with tagsAdd. It never guesses which side effect
ran twice, it only flags the order so a human (or a companion repair job) can look at it.
Read only apart from the tag. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dedupe_webhook_deliveries")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "7"))
REVIEW_TAG = os.environ.get("REVIEW_TAG", "duplicate-webhook")
WEBHOOK_TAG_PREFIX = os.environ.get("WEBHOOK_TAG_PREFIX", "wh-")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 50, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      tags
      totalReceivedSet { shopMoney { amount currencyCode } }
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


def webhook_ids_seen(tags, prefix):
    """Pull the webhook ids a handler stamped onto the order, in order of appearance."""
    return [t[len(prefix):] for t in (tags or []) if t.startswith(prefix)]


def find_duplicate_webhook_id(tags, prefix):
    """Pure decision function, no I/O.

    Given an order's tags, return the first webhook id that was stamped more than once,
    or None if every delivery the order has seen so far was processed exactly once.
    A duplicate here means the same X-Shopify-Webhook-Id ran the handler twice, which is
    the signature of a retried or duplicated delivery slipping past dedupe.
    """
    seen = set()
    for wid in webhook_ids_seen(tags, prefix):
        if wid in seen:
            return wid
        seen.add(wid)
    return None


def already_flagged(tags, review_tag):
    return review_tag in (tags or [])


def should_flag_for_review(order, prefix, review_tag):
    """Pure decision function, no I/O. Decides whether an order needs a review tag."""
    if already_flagged(order.get("tags"), review_tag):
        return False
    return find_duplicate_webhook_id(order.get("tags"), prefix) is not None


def flag_for_review(order_id, review_tag):
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
        if not should_flag_for_review(order, WEBHOOK_TAG_PREFIX, REVIEW_TAG):
            continue
        dup_id = find_duplicate_webhook_id(order.get("tags"), WEBHOOK_TAG_PREFIX)
        received_cents = to_cents((order.get("totalReceivedSet") or {}).get("shopMoney", {}).get("amount", "0"))
        log.warning(
            "Order %s saw webhook id %s more than once (received %s cents). %s",
            order["name"], dup_id, received_cents, "would tag" if DRY_RUN else "tagging",
        )
        if not DRY_RUN:
            flag_for_review(order["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d order(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
