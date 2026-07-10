"""Find Shopify checkouts that were actually paid but never became an order.

A checkout can finish payment (Shopify records completedAt on the abandoned
checkout record) while the order write never lands, for example a webhook
that timed out, an app that crashed mid write, or a duplicate submit that
raced itself. Shopify's own abandoned checkout report still calls this
"abandoned" because no order followed, so real, paid checkouts hide in a
list meant for carts nobody finished. This job lists recently completed
checkouts, checks whether a matching order exists with checkout_token, and
tags the ones that are paid with nothing behind them for a human to
reconcile with reconcile_tag. Read only apart from the tag. Run on a
schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_stranded_checkouts")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "3"))
MIN_STRANDED_CENTS = int(os.environ.get("MIN_STRANDED_CENTS", "1"))
RECONCILE_TAG = os.environ.get("RECONCILE_TAG", "stranded-checkout")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ABANDONED_CHECKOUTS_QUERY = """
query($cursor: String) {
  abandonedCheckouts(first: 50, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      completedAt
      updatedAt
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { email }
    }
  }
}"""

ORDER_BY_CHECKOUT_TOKEN_QUERY = """
query($q: String!) {
  orders(first: 1, query: $q) {
    nodes { id name }
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


def checkout_token_from_gid(gid):
    """The abandoned checkout gid ends in the numeric checkout id, which is
    also the token orders were written with. gid://shopify/AbandonedCheckout/123
    becomes "123"."""
    return gid.rsplit("/", 1)[-1]


def is_stranded(checkout, has_matching_order, min_cents=MIN_STRANDED_CENTS):
    """Pure decision: true when a checkout finished payment, is worth
    reconciling, and no order exists for it.

    checkout is a dict with at least "completedAt" and "totalPriceSet".
    has_matching_order is a bool the caller already looked up.
    """
    if not checkout.get("completedAt"):
        return False
    if has_matching_order:
        return False
    amount = (checkout.get("totalPriceSet") or {}).get("shopMoney", {}).get("amount", "0")
    return to_cents(amount) >= min_cents


def order_exists_for_checkout(checkout_gid):
    token = checkout_token_from_gid(checkout_gid)
    data = gql(ORDER_BY_CHECKOUT_TOKEN_QUERY, {"q": f"checkout_token:{token}"})["orders"]
    return len(data["nodes"]) > 0


def tag_for_reconciliation(checkout_id, reconcile_tag):
    result = gql(TAGS_ADD, {"id": checkout_id, "tags": [reconcile_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def recently_completed_checkouts():
    cursor = None
    while True:
        data = gql(ABANDONED_CHECKOUTS_QUERY, {"cursor": cursor})["abandonedCheckouts"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    flagged = 0
    for checkout in recently_completed_checkouts():
        if not checkout.get("completedAt"):
            continue
        has_order = order_exists_for_checkout(checkout["id"])
        if not is_stranded(checkout, has_order):
            continue
        log.warning(
            "Checkout %s completed with no order. %s",
            checkout.get("name") or checkout["id"],
            "would tag" if DRY_RUN else "tagging",
        )
        if not DRY_RUN:
            tag_for_reconciliation(checkout["id"], RECONCILE_TAG)
        flagged += 1
    log.info("Done. %d checkout(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
