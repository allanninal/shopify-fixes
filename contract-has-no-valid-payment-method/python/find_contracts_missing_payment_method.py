"""Find active Shopify subscription contracts that have no valid payment method.

A contract can end up with lastPaymentStatus of NO_PAYMENT_METHOD when the
customer's card was removed, the vault entry was revoked by the customer's
bank, or the contract was created without one attached. Shopify will keep
trying to bill on schedule and keep failing silently unless someone notices.
This job pages through active contracts, applies a pure decision function to
flag the ones that cannot bill, and tags them for review with tagsAdd so a
human can email the buyer for a new card. It never touches billing or money
itself. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_contracts_missing_payment_method")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
REVIEW_TAG = os.environ.get("REVIEW_TAG", "needs-payment-method")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ACTIVE_STATUSES = {"ACTIVE"}
NO_METHOD_PAYMENT_STATUSES = {"NO_PAYMENT_METHOD", "PENDING_SETTING_UP_PAYMENT_METHOD"}

CONTRACTS_QUERY = """
query($cursor: String) {
  subscriptionContracts(first: 50, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      status
      lastPaymentStatus
      customer { id email }
      customerPaymentMethod { id revokedAt instrument { __typename } }
      currentPeriodEnd
      tags
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


def has_no_valid_payment_method(contract):
    """True when an active contract cannot bill because it has no usable payment method.

    A contract cannot bill when any of these hold:
    - Shopify's own lastPaymentStatus already says there is no payment method
    - the payment method was revoked (the bank or the customer pulled it)
    - the contract has no payment method attached at all
    Cancelled, paused, or already-flagged contracts are left alone.
    """
    if contract.get("status") not in ACTIVE_STATUSES:
        return False
    method = contract.get("customerPaymentMethod")
    if contract.get("lastPaymentStatus") in NO_METHOD_PAYMENT_STATUSES:
        return True
    if method is None:
        return True
    if method.get("revokedAt"):
        return True
    return False


def needs_tag(contract, review_tag):
    if not has_no_valid_payment_method(contract):
        return False
    return review_tag not in (contract.get("tags") or [])


def tag_for_review(contract_id, review_tag):
    result = gql(TAGS_ADD, {"id": contract_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def active_contracts():
    cursor = None
    while True:
        data = gql(CONTRACTS_QUERY, {"cursor": cursor})["subscriptionContracts"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    flagged = 0
    for contract in active_contracts():
        if not needs_tag(contract, REVIEW_TAG):
            continue
        email = (contract.get("customer") or {}).get("email", "unknown")
        log.warning("Contract %s (%s) has no valid payment method. %s",
                    contract["id"], email, "would tag" if DRY_RUN else "tagging")
        if not DRY_RUN:
            tag_for_review(contract["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d contract(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
