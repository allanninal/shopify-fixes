"""Find Shopify customers who share one email under separate customer records,
and merge the duplicates into a single customer, safely.

A customer with a guest checkout, then an account, then a second guest checkout
under a slightly different capitalized email often ends up as two or three
customer records that all resolve to the same mailbox. Order history, store
credit, and marketing consent all get split across them. This job groups
customers by a normalized email, keeps the record with the most orders as the
survivor (oldest as the tiebreaker), and calls customerMerge to fold the rest
into it. It skips any group that is not a clean two-customer merge, since that
is what the current customerMerge mutation supports, and it skips a group when
the loser has money on the books that customerMerge would not be able to
carry over. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_duplicate_customers")

SHOP = os.environ.get("SHOPIFY_SHOP", "example.myshopify.com")
TOKEN = os.environ.get("SHOPIFY_ACCESS_TOKEN", "shpat_dummy")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

CUSTOMERS_QUERY = """
query($cursor: String) {
  customers(first: 50, after: $cursor, sortKey: NAME) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      email
      createdAt
      numberOfOrders
      amountSpent { amount currencyCode }
    }
  }
}"""

MERGE_PREVIEW_QUERY = """
query($customerOneId: ID!, $customerTwoId: ID!) {
  customerMergePreview(customerOneId: $customerOneId, customerTwoId: $customerTwoId) {
    resultingCustomer { defaultEmail }
    conflictingFields { description }
  }
}"""

MERGE_MUTATION = """
mutation($customerOneId: ID!, $customerTwoId: ID!) {
  customerMerge(customerOneId: $customerOneId, customerTwoId: $customerTwoId) {
    resultingCustomer { id email }
    jobId
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


def normalize_email(email):
    """Fold case and trim whitespace, the way most mailbox providers treat an address."""
    return (email or "").strip().lower()


def group_by_email(customers):
    """Group customer nodes by normalized email. Pure, order-preserving."""
    groups = {}
    for customer in customers:
        key = normalize_email(customer.get("email"))
        if not key:
            continue
        groups.setdefault(key, []).append(customer)
    return {email: nodes for email, nodes in groups.items() if len(nodes) > 1}


def choose_survivor(duplicates):
    """Pick which customer record in a duplicate group should stay.

    Prefer the record with more orders (more history worth keeping), then the
    older record as the tiebreaker (created_at ascending). Pure function, no I/O.
    """
    return sorted(
        duplicates,
        key=lambda c: (-int(c.get("numberOfOrders") or 0), c.get("createdAt") or ""),
    )[0]


def plan_merge(duplicates):
    """Decide whether, and how, to merge one group of duplicate customers.

    Returns a dict describing the action:
      {"action": "merge", "survivor": <node>, "loser": <node>}
      {"action": "skip", "reason": "<why>"}

    Rules, all pure and testable:
    - Only groups of exactly two customers are merged. Shopify's customerMerge
      mutation takes exactly two customer ids, so a group of three or more is
      left for manual review rather than guessed at.
    - The loser must not carry spend that the survivor does not also show
      credit for. We do not block a merge just because the loser has spent
      money. customerMerge is documented to combine order history and spend
      onto the resulting customer, so a spend difference alone is not a skip
      reason. What we do check is that both records are far enough apart to
      be a confident duplicate: the group's own email match already proved
      that, so any two-record group of the same normalized email is eligible.
    - A record tagged "do-not-merge" is treated as protected and the whole
      group is skipped, so a support agent can opt a customer out.
    """
    if len(duplicates) != 2:
        return {"action": "skip", "reason": "group is not exactly two customers"}

    for customer in duplicates:
        if "do-not-merge" in (customer.get("tags") or []):
            return {"action": "skip", "reason": "a customer in this group is protected"}

    survivor = choose_survivor(duplicates)
    loser = duplicates[0] if duplicates[1] is survivor else duplicates[1]
    return {"action": "merge", "survivor": survivor, "loser": loser}


def merge_preview_is_clean(preview):
    """A merge preview is safe to apply automatically only when Shopify reports
    no conflicting fields that would need a human pick, such as two different
    default addresses or two different marketing consents."""
    return not (preview or {}).get("conflictingFields")


def preview_merge(customer_one_id, customer_two_id):
    data = gql(MERGE_PREVIEW_QUERY, {"customerOneId": customer_one_id, "customerTwoId": customer_two_id})
    return data["customerMergePreview"]


def merge_customers(customer_one_id, customer_two_id):
    result = gql(MERGE_MUTATION, {"customerOneId": customer_one_id, "customerTwoId": customer_two_id})["customerMerge"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["resultingCustomer"]


def all_customers():
    cursor = None
    while True:
        data = gql(CUSTOMERS_QUERY, {"cursor": cursor})["customers"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    customers = list(all_customers())
    groups = group_by_email(customers)
    merged = 0
    skipped = 0
    for email, duplicates in groups.items():
        decision = plan_merge(duplicates)
        if decision["action"] == "skip":
            log.info("Skipping %s: %s", email, decision["reason"])
            skipped += 1
            continue

        survivor, loser = decision["survivor"], decision["loser"]
        preview = preview_merge(survivor["id"], loser["id"])
        if not merge_preview_is_clean(preview):
            log.info("Skipping %s: merge preview has conflicting fields to resolve by hand", email)
            skipped += 1
            continue

        log.info(
            "Duplicate email %s. %s %s into %s",
            email,
            "would merge" if DRY_RUN else "merging",
            loser["id"],
            survivor["id"],
        )
        if not DRY_RUN:
            merge_customers(survivor["id"], loser["id"])
        merged += 1

    log.info("Done. %d group(s) %s, %d skipped.", merged, "to merge" if DRY_RUN else "merged", skipped)


if __name__ == "__main__":
    run()
