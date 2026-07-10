"""Find Shopify orders that were charged twice and refund the extra charge.

A retry, a double click, or an app that captured an order more than once can leave
two successful SALE or CAPTURE transactions of the same amount on one order. This
lists recent orders, finds the duplicate successful charges, and refunds the extras
with refundCreate. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_duplicate_charges")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "7"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CHARGE_KINDS = {"SALE", "CAPTURE"}

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name
      transactions(first: 20) {
        id kind status
        amountSet { shopMoney { amount currencyCode } }
      }
    }
  }
}"""

REFUND_MUTATION = """
mutation($input: RefundInput!) {
  refundCreate(input: $input) {
    refund { id }
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


def duplicate_sale_transactions(transactions):
    """Return the extra successful charges: for each amount, every successful
    SALE/CAPTURE transaction after the first is a duplicate to refund."""
    seen = set()
    extras = []
    for t in transactions or []:
        if t.get("kind") in CHARGE_KINDS and t.get("status") == "SUCCESS":
            amount = t["amountSet"]["shopMoney"]["amount"]
            if amount in seen:
                extras.append(t)
            else:
                seen.add(amount)
    return extras


def refund(order_id, txn):
    money = txn["amountSet"]["shopMoney"]
    result = gql(REFUND_MUTATION, {"input": {
        "orderId": order_id,
        "transactions": [{
            "parentId": txn["id"],
            "amount": money["amount"],
            "gateway": "shopify_payments",
            "kind": "REFUND",
        }],
    }})["refundCreate"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["refund"]["id"]


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
    refunded = 0
    for order in recent_orders():
        extras = duplicate_sale_transactions(order["transactions"])
        for txn in extras:
            money = txn["amountSet"]["shopMoney"]
            log.warning("Order %s has a duplicate charge of %s %s. %s",
                        order["name"], money["amount"], money["currencyCode"],
                        "would refund" if DRY_RUN else "refunding")
            if not DRY_RUN:
                refund(order["id"], txn)
            refunded += 1
    log.info("Done. %d duplicate charge(s) %s.", refunded, "to refund" if DRY_RUN else "refunded")


if __name__ == "__main__":
    run()
