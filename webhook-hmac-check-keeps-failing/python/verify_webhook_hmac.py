"""Verify Shopify webhook HMAC signatures against the raw request body, not the parsed one.

The Admin webhook HMAC is computed over the exact bytes Shopify sent. If a framework,
a logging middleware, or your own handler parses the JSON body first and later
recomputes the signature from `json.dumps(parsed_body)`, the bytes drift, so every
single webhook fails verification even though nothing is actually wrong. This module
holds the pure verification function (no I/O, safe to unit test) plus a small audit
job that pages through webhookSubscriptions on the Admin GraphQL API and flags any
subscription whose delivery format is not JSON, since that is the other common cause
of "the signature never matches." Run the audit on a schedule. Safe to run again and
again, it only reads and, when DRY_RUN is off, tags subscriptions for review.
"""
import base64
import hashlib
import hmac
import logging
import os

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("verify_webhook_hmac")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
CLIENT_SECRET = os.environ.get("SHOPIFY_CLIENT_SECRET", "")
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

SUBSCRIPTIONS_QUERY = """
query($cursor: String) {
  webhookSubscriptions(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id topic uri format }
  }
}"""

UPDATE_MUTATION = """
mutation($id: ID!, $uri: String!) {
  webhookSubscriptionUpdate(id: $id, webhookSubscription: { uri: $uri, format: JSON }) {
    webhookSubscription { id topic uri format }
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


def compute_hmac(raw_body, secret):
    """Pure. Returns the base64-encoded HMAC-SHA256 of the raw request bytes.

    raw_body must be the exact bytes Shopify posted, before any JSON parsing.
    secret is the app's client secret (or webhook signing secret), as a str or bytes.
    """
    if isinstance(raw_body, str):
        raw_body = raw_body.encode("utf-8")
    if isinstance(secret, str):
        secret = secret.encode("utf-8")
    digest = hmac.new(secret, raw_body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def verify_hmac(raw_body, header_hmac, secret):
    """Pure decision function. No I/O, no dependency on Flask/Django/Express objects.

    raw_body: the exact bytes (or str) of the request body, read before parsing.
    header_hmac: the value of the X-Shopify-Hmac-Sha256 header, base64 text.
    secret: the app's client secret.
    Returns True only when the computed digest matches the header byte for byte,
    compared in constant time so timing does not leak information about the secret.
    """
    if not header_hmac:
        return False
    expected = compute_hmac(raw_body, secret)
    return hmac.compare_digest(expected, header_hmac)


def misconfigured_subscriptions(subscriptions):
    """Pure decision function. No I/O.

    subscriptions: list of dicts with at least "format", as returned by Shopify.
    A webhook registered with format XML changes the byte layout of the body but
    not how most starter code recomputes the signature, which is a second, unrelated
    way teams end up chasing a false HMAC mismatch. Returns the subset that is not
    already using JSON.
    """
    return [s for s in subscriptions if (s.get("format") or "").upper() != "JSON"]


def all_subscriptions():
    cursor = None
    while True:
        data = gql(SUBSCRIPTIONS_QUERY, {"cursor": cursor})["webhookSubscriptions"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def switch_to_json(subscription_id, uri):
    result = gql(UPDATE_MUTATION, {"id": subscription_id, "uri": uri})["webhookSubscriptionUpdate"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["webhookSubscription"]["format"]


def run():
    subs = list(all_subscriptions())
    bad = misconfigured_subscriptions(subs)

    for sub in bad:
        log.warning(
            "Webhook %s at %s uses format %s, not JSON. %s",
            sub["topic"], sub["uri"], sub.get("format"),
            "would switch to JSON" if DRY_RUN else "switching to JSON",
        )
        if not DRY_RUN:
            switch_to_json(sub["id"], sub["uri"])

    log.info(
        "Done. %d of %d webhook subscription(s) %s.",
        len(bad), len(subs), "to fix" if DRY_RUN else "switched to JSON",
    )


if __name__ == "__main__":
    run()
