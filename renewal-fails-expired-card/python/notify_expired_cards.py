"""Email subscribers whose saved card is expired or revoked, before the renewal fails.

A subscription renewal fails when the card on the contract has expired or the payment
method was revoked. Instead of waiting for the failed billing attempt, this walks the
active contracts, finds the ones whose card is expired or whose method is gone, and
sends the built-in update-payment-method email with customerPaymentMethodSendUpdateEmail.
Run on a schedule. Safe to run again and again.
"""
import os
import datetime
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("notify_expired_cards")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CONTRACTS_QUERY = """
query($cursor: String) {
  subscriptionContracts(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id status
      customerPaymentMethod {
        id revokedAt
        instrument { ... on CustomerCreditCard { expiryMonth expiryYear } }
      }
    }
  }
}"""

SEND_EMAIL = """
mutation($id: ID!) {
  customerPaymentMethodSendUpdateEmail(customerPaymentMethodId: $id) {
    customer { id }
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


def card_expired(month, year, now_year, now_month):
    """A card is expired once the month after its expiry has started."""
    if month is None or year is None:
        return False
    return (year, month) < (now_year, now_month)


def needs_update(contract, now_year, now_month):
    if contract.get("status") != "ACTIVE":
        return False
    pm = contract.get("customerPaymentMethod")
    if pm is None:
        return False
    if pm.get("revokedAt"):
        return True
    card = pm.get("instrument") or {}
    return card_expired(card.get("expiryMonth"), card.get("expiryYear"), now_year, now_month)


def send_update_email(payment_method_id):
    result = gql(SEND_EMAIL, {"id": payment_method_id})["customerPaymentMethodSendUpdateEmail"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def contracts():
    cursor = None
    while True:
        data = gql(CONTRACTS_QUERY, {"cursor": cursor})["subscriptionContracts"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    today = datetime.date.today()
    notified = 0
    seen = set()
    for contract in contracts():
        if not needs_update(contract, today.year, today.month):
            continue
        pm_id = contract["customerPaymentMethod"]["id"]
        if pm_id in seen:
            continue
        seen.add(pm_id)
        log.warning("Contract %s has an expired or revoked card. %s",
                    contract["id"], "would email" if DRY_RUN else "emailing")
        if not DRY_RUN:
            send_update_email(pm_id)
        notified += 1
    log.info("Done. %d customer(s) %s.", notified, "to email" if DRY_RUN else "emailed")


if __name__ == "__main__":
    run()
