"""Flag Shopify orders where the presentment currency and the settlement currency
do not agree in the way your reports expect.

A buyer in the UK sees GBP at checkout (presentmentMoney), but if your store settles
in USD, the money that actually lands in your payout is in USD (shopMoney). Reports
that read the wrong side of that pair, or that mix the two without converting, end up
quietly wrong. This job reads each recent order's totalReceivedSet on both sides,
computes the implied exchange rate, and tags for review any order where the currency
pair looks unexpected or the implied rate falls outside a sane band. Read only apart
from the tag. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_currency_mismatch")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "7"))
SETTLEMENT_CURRENCY = os.environ.get("SETTLEMENT_CURRENCY", "USD")
REVIEW_TAG = os.environ.get("REVIEW_TAG", "currency-mismatch")
# An implied rate outside this band usually means a bad read, not a real conversion.
MIN_RATE = float(os.environ.get("MIN_RATE", "0.01"))
MAX_RATE = float(os.environ.get("MAX_RATE", "100"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name tags
      totalReceivedSet {
        shopMoney { amount currencyCode }
        presentmentMoney { amount currencyCode }
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


def implied_rate(shop_cents, presentment_cents):
    """Presentment currency amount per one unit of settlement currency.

    Returns None when either side is zero or missing, since no rate can be implied.
    """
    if shop_cents == 0 or presentment_cents == 0:
        return None
    return presentment_cents / shop_cents


def needs_review(order, settlement_currency, min_rate, max_rate):
    """Pure decision function: does this order need a currency review tag?

    Flags an order when:
      - the settlement side (shopMoney) is not in the currency the shop expects, or
      - both sides share the same currency code but the amounts differ (a broken
        conversion, since same currency should mean same amount), or
      - the implied rate between presentment and settlement falls outside a sane band.
    Takes only plain values, does no I/O, so it is easy to unit test.
    """
    totals = order.get("totalReceivedSet") or {}
    shop = totals.get("shopMoney") or {}
    presentment = totals.get("presentmentMoney") or {}

    shop_currency = shop.get("currencyCode")
    presentment_currency = presentment.get("currencyCode")
    if shop_currency is None or presentment_currency is None:
        return False

    if shop_currency != settlement_currency:
        return True

    shop_cents = to_cents(shop.get("amount", "0"))
    presentment_cents = to_cents(presentment.get("amount", "0"))

    if shop_currency == presentment_currency:
        return shop_cents != presentment_cents

    rate = implied_rate(shop_cents, presentment_cents)
    if rate is None:
        return True
    return rate < min_rate or rate > max_rate


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


def tag_for_review(order_id, review_tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def run():
    flagged = 0
    for order in recent_orders():
        if not needs_review(order, SETTLEMENT_CURRENCY, MIN_RATE, MAX_RATE):
            continue
        if REVIEW_TAG in (order.get("tags") or []):
            continue
        log.warning("Order %s currency pair looks off. %s",
                    order["name"], "would tag" if DRY_RUN else "tagging")
        if not DRY_RUN:
            tag_for_review(order["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d order(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
