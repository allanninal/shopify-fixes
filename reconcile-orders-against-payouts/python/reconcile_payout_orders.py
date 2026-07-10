"""Tie a Shopify Payments payout to its balance transactions to the cent.

A bank deposit is one number. The orders behind it are many. When the sum of
a payout's balance transactions (charges minus refunds minus fees, in other
words `net`) does not equal the payout's own `net` amount, either a balance
transaction is missing from the page you fetched, a currency got mixed in, or
Shopify's own numbers disagree, and finance will chase the gap by hand. This
script pages through recent payouts, sums the `net` of every balance
transaction associated with each one, and tags the payouts that do not tie
out for review with `tagsAdd`. Read only apart from the tag. Run on a
schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("reconcile_payout_orders")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
PAYOUT_LOOKBACK = int(os.environ.get("PAYOUT_LOOKBACK", "10"))
REVIEW_TAG = os.environ.get("REVIEW_TAG", "payout-mismatch")
TOLERANCE_CENTS = int(os.environ.get("TOLERANCE_CENTS", "1"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

PAYOUTS_QUERY = """
query($first: Int!) {
  shopifyPaymentsAccount {
    payouts(first: $first, sortKey: ISSUED_AT, reverse: true) {
      nodes {
        id
        status
        issuedAt
        net { amount currencyCode }
      }
    }
  }
}"""

BALANCE_TRANSACTIONS_QUERY = """
query($cursor: String) {
  shopifyPaymentsAccount {
    balanceTransactions(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        associatedPayout { id }
        associatedOrder { id name }
        net { amount currencyCode }
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


def net_transactions_cents(transactions, payout_id):
    """Sum the net of every balance transaction associated with this payout, in minor units."""
    total = 0
    for t in transactions or []:
        payout = t.get("associatedPayout") or {}
        if payout.get("id") != payout_id:
            continue
        total += to_cents(t["net"]["amount"])
    return total


def payout_mismatch_cents(payout, transactions):
    """Return the gap in cents between a payout's own net and its summed transactions.

    A positive number means the payout reports more than the transactions add up to.
    A negative number means the transactions add up to more than the payout reports.
    """
    payout_net = to_cents(payout["net"]["amount"])
    summed_net = net_transactions_cents(transactions, payout["id"])
    return payout_net - summed_net


def is_mismatch(payout, transactions, tolerance_cents=TOLERANCE_CENTS):
    return abs(payout_mismatch_cents(payout, transactions)) > tolerance_cents


def tag_for_review(payout_id, review_tag):
    result = gql(TAGS_ADD, {"id": payout_id, "tags": [review_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def recent_payouts():
    data = gql(PAYOUTS_QUERY, {"first": PAYOUT_LOOKBACK})["shopifyPaymentsAccount"]
    return data["payouts"]["nodes"]


def all_balance_transactions():
    cursor = None
    out = []
    while True:
        data = gql(BALANCE_TRANSACTIONS_QUERY, {"cursor": cursor})["shopifyPaymentsAccount"]
        page = data["balanceTransactions"]
        out.extend(page["nodes"])
        if not page["pageInfo"]["hasNextPage"]:
            return out
        cursor = page["pageInfo"]["endCursor"]


def run():
    payouts = recent_payouts()
    transactions = all_balance_transactions()
    flagged = 0
    for payout in payouts:
        gap = payout_mismatch_cents(payout, transactions)
        if abs(gap) <= TOLERANCE_CENTS:
            continue
        log.warning(
            "Payout %s off by %s cents. %s",
            payout["id"], gap, "would tag" if DRY_RUN else "tagging",
        )
        if not DRY_RUN:
            tag_for_review(payout["id"], REVIEW_TAG)
        flagged += 1
    log.info("Done. %d payout(s) %s.", flagged, "to tag" if DRY_RUN else "tagged")


if __name__ == "__main__":
    run()
