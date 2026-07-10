"""Detect and recreate Shopify webhook subscriptions that Shopify auto-deleted.

Shopify removes a webhook subscription on its own after delivery keeps failing,
for example your endpoint was down for days or kept returning errors. The app
never hears about the removal. It just quietly stops receiving that topic, and
the gap is invisible until someone notices an order or a fulfillment never
triggered the expected side effect.

This job compares the webhook subscriptions you require (topic and endpoint
URI) against what Shopify actually has registered with webhookSubscriptions,
and recreates the ones that are missing with webhookSubscriptionCreate. It
never deletes or edits a subscription that already exists, it only fills gaps.
Run on a schedule. Safe to run again and again.
"""
import json
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("recreate_missing_webhooks")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

# A JSON array of {"topic": "...", "uri": "..."} pairs your app depends on.
# Example: [{"topic": "ORDERS_PAID", "uri": "https://app.example.com/webhooks/orders-paid"}]
REQUIRED_WEBHOOKS = json.loads(os.environ.get("REQUIRED_WEBHOOKS", "[]"))

SUBSCRIPTIONS_QUERY = """
query($cursor: String) {
  webhookSubscriptions(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id topic uri format createdAt }
  }
}"""

CREATE_MUTATION = """
mutation($topic: WebhookSubscriptionTopic!, $uri: String!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
    webhookSubscription { id topic uri }
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


def missing_subscriptions(existing, required):
    """Pure decision function. No I/O.

    existing: list of dicts with at least "topic" and "uri", read from Shopify.
    required: list of dicts with "topic" and "uri", the app's declared needs.
    Returns the entries from required that have no matching existing
    subscription on the same topic and uri. Comparison is case-sensitive on
    uri and normalizes topic to uppercase, since Shopify always returns the
    topic enum in upper snake case.
    """
    live = {(item.get("topic") or "").upper() for item in existing}
    live_pairs = {
        ((item.get("topic") or "").upper(), item.get("uri"))
        for item in existing
    }
    gaps = []
    for need in required:
        key = (need.get("topic", "").upper(), need.get("uri"))
        if key in live_pairs:
            continue
        gaps.append(need)
    return gaps


def existing_subscriptions():
    cursor = None
    while True:
        data = gql(SUBSCRIPTIONS_QUERY, {"cursor": cursor})["webhookSubscriptions"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def create_subscription(topic, uri):
    result = gql(CREATE_MUTATION, {"topic": topic, "uri": uri})["webhookSubscriptionCreate"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["webhookSubscription"]


def run():
    if not REQUIRED_WEBHOOKS:
        log.warning("REQUIRED_WEBHOOKS is empty. Nothing to check. Set it to a JSON list of {topic, uri}.")
        return

    current = list(existing_subscriptions())
    gaps = missing_subscriptions(current, REQUIRED_WEBHOOKS)

    for gap in gaps:
        log.warning("Missing webhook subscription for %s at %s. %s",
                    gap["topic"], gap["uri"], "would recreate" if DRY_RUN else "recreating")
        if not DRY_RUN:
            create_subscription(gap["topic"], gap["uri"])

    log.info("Done. %d subscription(s) %s out of %d required.",
              len(gaps), "to recreate" if DRY_RUN else "recreated", len(REQUIRED_WEBHOOKS))


if __name__ == "__main__":
    run()
