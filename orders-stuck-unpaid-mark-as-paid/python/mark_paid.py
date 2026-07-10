"""Mark Shopify orders that were paid outside checkout as Paid, safely.
Only touches orders that are eligible (canMarkAsPaid) and carry a confirmation tag.
Run on a schedule. Safe to run again and again.

Guide: https://www.allanninal.dev/shopify/orders-stuck-unpaid-mark-as-paid/
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mark_paid")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
HEADERS = {"X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json"}
MARK_TAG = os.environ.get("MARK_PAID_TAG", "paid-externally")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ELIGIBLE_STATUSES = {"PENDING", "PARTIALLY_PAID"}


def eligible_to_mark(order, required_tag):
    if not order.get("canMarkAsPaid"):
        return False
    if order.get("displayFinancialStatus") not in ELIGIBLE_STATUSES:
        return False
    return required_tag in (order.get("tags") or [])


def gql(query, variables=None):
    r = requests.post(ENDPOINT, json={"query": query, "variables": variables or {}}, headers=HEADERS, timeout=30)
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise RuntimeError(body["errors"])
    return body["data"]


ORDERS_QUERY = """
query($cursor: String) {
  orders(first: 50, after: $cursor, query: "financial_status:pending OR financial_status:partially_paid") {
    pageInfo { hasNextPage endCursor }
    nodes { id name displayFinancialStatus canMarkAsPaid tags }
  }
}
"""

MARK_MUTATION = """
mutation($id: ID!) {
  orderMarkAsPaid(input: { id: $id }) {
    order { id displayFinancialStatus }
    userErrors { field message }
  }
}
"""


def orders():
    cursor = None
    while True:
        data = gql(ORDERS_QUERY, {"cursor": cursor})["orders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def mark_paid(order_id):
    result = gql(MARK_MUTATION, {"id": order_id})["orderMarkAsPaid"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def run():
    fixed = 0
    for order in orders():
        if not eligible_to_mark(order, MARK_TAG):
            continue
        log.info("Order %s eligible. %s", order["name"], "dry run" if DRY_RUN else "marking paid")
        if not DRY_RUN:
            mark_paid(order["id"])
        fixed += 1
    log.info("Done. %d order(s) %s.", fixed, "to mark" if DRY_RUN else "marked paid")


if __name__ == "__main__":
    run()
