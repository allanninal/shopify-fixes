"""Flag Shopify orders created by a billing attempt that fired after the
subscription contract was already cancelled.

Cancelling a SubscriptionContract stops future billing cycles, but a billing
attempt that was already queued (or that a retry re-queued) can still land and
create an order after the contract's status flips to CANCELLED. The order
looks ordinary, but it was never supposed to exist. This job walks recent
subscription contracts, reads their billing attempts, and tags any attempt
that produced an order (or is still pending) after the contract's cancelledAt
timestamp with a review tag on the resulting order via tagsAdd.

Read only apart from the tag. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("flag_attempts_after_cancel")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
REVIEW_TAG = os.environ.get("REVIEW_TAG", "billed-after-cancel")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CANCELLED_STATUSES = {"CANCELLED", "EXPIRED"}

CONTRACTS_QUERY = """
query($cursor: String) {
  subscriptionContracts(first: 25, after: $cursor,
                         query: "status:CANCELLED OR status:EXPIRED") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id status cancelledAt
      billingAttempts(first: 20) {
        nodes {
          id createdAt ready
          order { id name tags }
        }
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


def attempt_ran_after_cancel(contract, attempt):
    """True when a billing attempt fired (or is still pending) after the
    contract was cancelled or expired. Pure: takes plain dicts, no I/O.
    """
    if contract.get("status") not in CANCELLED_STATUSES:
        return False
    cancelled_at = contract.get("cancelledAt")
    if not cancelled_at:
        return False
    created_at = attempt.get("createdAt")
    if not created_at:
        return False
    if created_at <= cancelled_at:
        return False
    # Only worth flagging if it actually produced an order, or is still
    # queued to (ready == False can mean "not yet resolved", which is just
    # as dangerous since it may still complete and bill the customer).
    return attempt.get("order") is not None or attempt.get("ready") is False


def attempts_needing_review(contract):
    """Yield the billing attempts on a contract that need a review tag."""
    for attempt in (contract.get("billingAttempts") or {}).get("nodes", []):
        if attempt_ran_after_cancel(contract, attempt):
            yield attempt


def tag_order_for_review(order_id, review_tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def cancelled_contracts():
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
    for contract in cancelled_contracts():
        for attempt in attempts_needing_review(contract):
            order = attempt.get("order")
            if order is None:
                log.warning(
                    "Contract %s has a billing attempt %s still pending after cancel.",
                    contract["id"], attempt["id"],
                )
                continue
            if REVIEW_TAG in (order.get("tags") or []):
                continue
            log.warning(
                "Order %s was created by attempt %s after contract %s was cancelled. %s",
                order["name"], attempt["id"], contract["id"],
                "would tag" if DRY_RUN else "tagging",
            )
            if not DRY_RUN:
                tag_order_for_review(order["id"], REVIEW_TAG)
            flagged += 1
    log.info("Done. %d order(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
