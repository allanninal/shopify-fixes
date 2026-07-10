"""Backfill Shopify orders whose webhooks were missed during downtime.

Shopify retries a failing webhook for up to 48 hours, then drops it for good.
If your endpoint was down longer than that, some orders never told you they
were paid, fulfilled, or cancelled. This job polls orders updated during the
outage window, keeps only the ones whose updatedAt falls inside that window
and that have not already been reprocessed, and re-applies the update by
tagging the order and logging what would have shipped in the missed webhook.
Read heavy, one small write. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("backfill_missed_webhooks")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

# The window your app was unreachable, in ISO 8601. Widen it a little on
# both sides, since Shopify's retry schedule is not instant either.
GAP_START = os.environ.get("GAP_START", "2026-07-05T00:00:00Z")
GAP_END = os.environ.get("GAP_END", "2026-07-06T00:00:00Z")
BACKFILL_TAG = os.environ.get("BACKFILL_TAG", "webhook-backfilled")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 50, after: $cursor, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name tags updatedAt
      displayFinancialStatus
      displayFulfillmentStatus
      cancelledAt
      totalReceivedSet { shopMoney { amount currencyCode } }
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


def needs_backfill(order, gap_start, gap_end, done_tag):
    """Pure decision. True when an order's own update happened inside the
    outage window and it has not already been marked as reprocessed.
    """
    updated_at = order.get("updatedAt")
    if not updated_at:
        return False
    if not (gap_start <= updated_at <= gap_end):
        return False
    return done_tag not in (order.get("tags") or [])


def summarize(order):
    """What the missed webhook would have told us, in plain fields we can
    log or replay into a local system. Money is kept in cents.
    """
    received = order.get("totalReceivedSet") or {}
    amount = (received.get("shopMoney") or {}).get("amount", "0")
    return {
        "id": order["id"],
        "name": order["name"],
        "financial_status": order.get("displayFinancialStatus"),
        "fulfillment_status": order.get("displayFulfillmentStatus"),
        "cancelled": bool(order.get("cancelledAt")),
        "total_received_cents": to_cents(amount),
    }


def mark_backfilled(order_id, done_tag):
    result = gql(TAGS_ADD, {"id": order_id, "tags": [done_tag]})["tagsAdd"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def updated_orders_in_gap():
    q = f"updated_at:>='{GAP_START}' AND updated_at:<='{GAP_END}'"
    cursor = None
    while True:
        data = gql(ORDERS_QUERY, {"cursor": cursor, "q": q})["orders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    backfilled = 0
    for order in updated_orders_in_gap():
        if not needs_backfill(order, GAP_START, GAP_END, BACKFILL_TAG):
            continue
        state = summarize(order)
        log.info(
            "Order %s missed a webhook. financial=%s fulfillment=%s received_cents=%d. %s",
            state["name"], state["financial_status"], state["fulfillment_status"],
            state["total_received_cents"], "would backfill" if DRY_RUN else "backfilling",
        )
        if not DRY_RUN:
            # Apply your own side effect here: sync to your database, send
            # an internal event, trigger fulfillment, etc. Then mark it done
            # so a later run never replays the same order twice.
            mark_backfilled(order["id"], BACKFILL_TAG)
        backfilled += 1
    log.info("Done. %d order(s) %s.", backfilled, "to backfill" if DRY_RUN else "backfilled")


if __name__ == "__main__":
    run()
