"""Write the dispute state onto Shopify orders that still show Paid.

A chargeback pulls the money through the card network right away, but Shopify
does not flip displayFinancialStatus when a dispute opens. The order keeps
reading Paid while the funds are already gone, so it slips past reconciliation
and reporting. This job lists recently paid orders, reads their disputes, and
tags the ones with an open chargeback so the order carries the true state.
Read-only apart from the tag. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("flag_open_chargebacks")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "30"))
CHARGEBACK_TAG = os.environ.get("CHARGEBACK_TAG", "chargeback-open")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

OPEN_DISPUTE_STATUSES = {"NEEDS_RESPONSE", "UNDER_REVIEW"}
STILL_LOOKS_PAID = {"PAID", "PARTIALLY_REFUNDED"}

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      tags
      displayFinancialStatus
      totalReceivedSet { shopMoney { amount currencyCode } }
      disputes { id initiatedAs status }
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


def has_open_chargeback(order):
    """True when at least one dispute on the order is an unresolved chargeback."""
    for dispute in order.get("disputes") or []:
        if dispute.get("initiatedAs") != "CHARGEBACK":
            continue
        if dispute.get("status") in OPEN_DISPUTE_STATUSES:
            return True
    return False


def needs_flag(order, required_tag):
    """Pure decision: should this order be tagged as carrying an open chargeback?

    True only when the order still displays as paid or partially refunded,
    it has at least one open chargeback dispute, and it is not already tagged.
    """
    if order.get("displayFinancialStatus") not in STILL_LOOKS_PAID:
        return False
    if not has_open_chargeback(order):
        return False
    return required_tag not in (order.get("tags") or [])


def disputed_amount_cents(order):
    """Sum of the shopMoney amount received on the order, in minor units.

    Exposed for reporting only; the decision above never depends on the
    exact amount, only on whether an open chargeback exists.
    """
    received = (order.get("totalReceivedSet") or {}).get("shopMoney", {}).get("amount", "0")
    return to_cents(received)


def flag_order(order_id, tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def recently_paid_orders():
    q = f"created_at:>-{LOOKBACK_DAYS}d AND (financial_status:paid OR financial_status:partially_refunded)"
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
    for order in recently_paid_orders():
        if not needs_flag(order, CHARGEBACK_TAG):
            continue
        log.warning(
            "Order %s shows %s but has an open chargeback for %s cents. %s",
            order["name"], order["displayFinancialStatus"], disputed_amount_cents(order),
            "would tag" if DRY_RUN else "tagging",
        )
        if not DRY_RUN:
            flag_order(order["id"], CHARGEBACK_TAG)
        flagged += 1
    log.info("Done. %d order(s) %s.", flagged, "to flag" if DRY_RUN else "flagged")


if __name__ == "__main__":
    run()
