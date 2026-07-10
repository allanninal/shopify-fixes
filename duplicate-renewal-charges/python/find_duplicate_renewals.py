"""Find subscription renewals that got billed twice for the same cycle.

A retry after a timeout or a webhook redelivered without an idempotency key can
create a second successful billing attempt for a contract that already has one
for the same cycle. Each attempt makes its own order and charges the card again,
so the customer pays twice for one box. This walks each active subscription
contract's recent billing attempts, groups them by billing cycle (the anniversary
date Shopify records on the attempt), flags every successful attempt after the
first one in a cycle as a duplicate, and tags the extra order for a refund review
with tagsAdd. Read only apart from the tag. Run on a schedule. Safe to run again
and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_duplicate_renewals")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
REVIEW_TAG = os.environ.get("REVIEW_TAG", "duplicate-renewal")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CONTRACTS_QUERY = """
query($cursor: String) {
  subscriptionContracts(first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      billingAttempts(first: 20, reverse: true) {
        nodes {
          id
          ready
          idempotencyKey
          originTime
          order {
            id
            name
            tags
            totalPriceSet { shopMoney { amount currencyCode } }
          }
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


def to_cents(amount):
    return round(float(amount) * 100)


def billing_cycle_key(attempt):
    """The billing cycle an attempt belongs to, truncated to the day.

    originTime is the anniversary date Shopify assigns to the attempt, so two
    attempts for the same renewal share the same day even if one was a retry
    made minutes or hours after the first.
    """
    origin = attempt.get("originTime") or ""
    return origin[:10]


def successful_attempts(attempts):
    """Only attempts that produced a real order are charges worth counting."""
    return [a for a in attempts if a.get("order") is not None]


def find_duplicate_orders(contract, review_tag):
    """Pure decision function. No I/O.

    Groups a contract's successful billing attempts by cycle. Within a cycle,
    the first attempt (attempts must be passed oldest first) is the legitimate
    charge and every attempt after it is a duplicate. Returns the order id,
    name, and amount in cents for each duplicate that is not already tagged,
    never the original charge.
    """
    attempts = successful_attempts(contract.get("billingAttempts") or [])
    seen_cycles = set()
    duplicates = []
    for attempt in attempts:
        cycle = billing_cycle_key(attempt)
        order = attempt["order"]
        if cycle not in seen_cycles:
            seen_cycles.add(cycle)
            continue
        if review_tag in (order.get("tags") or []):
            continue
        amount = to_cents(order["totalPriceSet"]["shopMoney"]["amount"])
        duplicates.append({"order_id": order["id"], "name": order["name"], "amount_cents": amount})
    return duplicates


def tag_for_review(order_id, review_tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [review_tag]})["tagsAdd"]
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
    flagged = 0
    for contract in contracts():
        # billingAttempts comes back newest first, flip it so the earliest
        # attempt in a cycle is treated as the original charge.
        attempts = list(reversed(contract.get("billingAttempts", {}).get("nodes") or []))
        ordered_contract = {**contract, "billingAttempts": attempts}
        for dup in find_duplicate_orders(ordered_contract, REVIEW_TAG):
            log.warning(
                "Order %s is a duplicate renewal charge (%s cents). %s",
                dup["name"], dup["amount_cents"], "would tag" if DRY_RUN else "tagging",
            )
            if not DRY_RUN:
                tag_for_review(dup["order_id"], REVIEW_TAG)
            flagged += 1
    log.info("Done. %d order(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
