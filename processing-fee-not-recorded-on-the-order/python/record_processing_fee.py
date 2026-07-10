"""Record the Shopify Payments processing fee onto its order, safely.

The order total is what the customer paid, not what you kept. The fee lives on
the order's own successful transactions as a TransactionFee, never on the order.
This sums the fee on each recent order's successful sale and capture transactions
and writes it back as a metafield in cents, once, so reports can compute net
revenue without a second trip to the payout report. Read only apart from the
metafield write. Run on a schedule. Safe to run again and again.

Guide: https://www.allanninal.dev/shopify/processing-fee-not-recorded-on-the-order/
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("record_processing_fee")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "14"))
FEE_NAMESPACE = os.environ.get("FEE_METAFIELD_NAMESPACE", "recon")
FEE_KEY = os.environ.get("FEE_METAFIELD_KEY", "processing_fee_cents")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CHARGE_KINDS = {"SALE", "CAPTURE"}

ORDERS_QUERY = """
query($cursor: String, $q: String!, $ns: String!, $key: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      feeMetafield: metafield(namespace: $ns, key: $key) { value }
      transactions(first: 10) {
        kind
        status
        fees { amount { amount currencyCode } }
      }
    }
  }
}"""

SET_FEE_MUTATION = """
mutation($id: ID!, $ns: String!, $key: String!, $value: String!) {
  orderUpdate(input: {
    id: $id
    metafields: [{ namespace: $ns, key: $key, type: "number_integer", value: $value }]
  }) {
    order { id }
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


def to_cents(amount):
    return round(float(amount) * 100)


def fee_cents_for_order(order):
    """Sum the processing fee on successful sale and capture transactions.

    Returns the fee in cents, or None if there is nothing new to record
    (the order already carries the metafield, or no fee was found).
    This function does no I/O, so it can be unit tested with plain dicts.
    """
    if (order.get("feeMetafield") or {}).get("value") is not None:
        return None  # already recorded, do not overwrite
    total = 0
    for t in order.get("transactions") or []:
        if t.get("status") != "SUCCESS" or t.get("kind") not in CHARGE_KINDS:
            continue
        for fee in t.get("fees") or []:
            total += to_cents(fee["amount"]["amount"])
    return total if total > 0 else None


def recent_orders():
    q = f"created_at:>-{LOOKBACK_DAYS}d"
    cursor = None
    while True:
        data = gql(ORDERS_QUERY, {"cursor": cursor, "q": q, "ns": FEE_NAMESPACE, "key": FEE_KEY})["orders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def write_fee(order_id, fee_cents):
    result = gql(SET_FEE_MUTATION, {
        "id": order_id, "ns": FEE_NAMESPACE, "key": FEE_KEY, "value": str(fee_cents),
    })["orderUpdate"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def run():
    recorded = 0
    for order in recent_orders():
        fee_cents = fee_cents_for_order(order)
        if fee_cents is None:
            continue
        log.info("Order %s fee %d cents. %s", order["name"], fee_cents,
                  "would record" if DRY_RUN else "recording")
        if not DRY_RUN:
            write_fee(order["id"], fee_cents)
        recorded += 1
    log.info("Done. %d order(s) %s.", recorded, "to record" if DRY_RUN else "recorded")


if __name__ == "__main__":
    run()
