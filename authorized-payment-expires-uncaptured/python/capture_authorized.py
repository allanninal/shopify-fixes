"""Capture Shopify orders whose payment is authorized but never captured.

When a store captures payments manually, the order sits at an AUTHORIZED financial
status. Shopify holds the authorization for a limited window (about 7 days for
Shopify Payments), then it expires and the money is lost. This lists AUTHORIZED
orders, keeps the ones Shopify reports as eligible with `capturable`, and calls
orderCapture for the outstanding amount. Run on a schedule. Safe to run again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("capture_authorized")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ORDERS_QUERY = """
query($cursor: String) {
  orders(first: 50, after: $cursor, query: "financial_status:authorized") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name displayFinancialStatus
      totalCapturableSet { shopMoney { amount currencyCode } }
      transactions(first: 10) { id kind status }
    }
  }
}"""

CAPTURE_MUTATION = """
mutation($id: ID!, $amount: MoneyInput!, $parent: ID!) {
  orderCapture(input: { id: $id, amount: $amount, parentTransactionId: $parent, finalCapture: true }) {
    transaction { id status kind }
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


def authorization_txn(order):
    """The transaction we capture against: a successful AUTHORIZATION."""
    for txn in order.get("transactions") or []:
        if txn.get("kind") == "AUTHORIZATION" and txn.get("status") == "SUCCESS":
            return txn
    return None


def capturable_amount(order):
    money = (order.get("totalCapturableSet") or {}).get("shopMoney") or {}
    return money.get("amount")


def eligible_to_capture(order):
    if order.get("displayFinancialStatus") != "AUTHORIZED":
        return False
    amount = capturable_amount(order)
    if amount is None or float(amount) <= 0:
        return False
    return authorization_txn(order) is not None


def capture(order):
    money = order["totalCapturableSet"]["shopMoney"]
    parent = authorization_txn(order)["id"]
    result = gql(CAPTURE_MUTATION, {
        "id": order["id"],
        "amount": {"amount": money["amount"], "currencyCode": money["currencyCode"]},
        "parent": parent,
    })["orderCapture"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["transaction"]["status"]


def authorized_orders():
    cursor = None
    while True:
        data = gql(ORDERS_QUERY, {"cursor": cursor})["orders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    captured = 0
    for order in authorized_orders():
        if not eligible_to_capture(order):
            continue
        log.info("Order %s eligible. %s", order["name"], "would capture" if DRY_RUN else "capturing")
        if not DRY_RUN:
            capture(order)
        captured += 1
    log.info("Done. %d order(s) %s.", captured, "to capture" if DRY_RUN else "captured")


if __name__ == "__main__":
    run()
