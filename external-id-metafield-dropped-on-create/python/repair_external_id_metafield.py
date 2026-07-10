"""Find orders whose external id metafield went missing on create, and set it back.

Some integrations write a linking key onto the order the moment it is created, usually
a metafield such as external_sync.external_id, so a warehouse system, a marketplace, or
an ERP can match the Shopify order back to its own record. When the order is created by
a flow that skips that write, such as a checkout that bypasses the app, a bulk import, or
a race between two systems creating the order at the same time, the metafield is never
set and the two systems can no longer find each other.

This script reads recent orders, compares the external_sync.external_id metafield against
the source of truth id you already have (for example your own order-to-external-id map),
and only repairs the ones that are missing or wrong, using metafieldsSet. It never touches
an order whose metafield already matches. Run on a schedule. Safe to run again and again.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("repair_external_id_metafield")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

METAFIELD_NAMESPACE = os.environ.get("METAFIELD_NAMESPACE", "external_sync")
METAFIELD_KEY = os.environ.get("METAFIELD_KEY", "external_id")

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 50, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      metafield(namespace: "external_sync", key: "external_id") { id value }
    }
  }
}"""

METAFIELDS_SET = """
mutation($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id key value }
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


def needs_repair(order, expected_external_id):
    """Pure decision: does this order's external id metafield need to be (re)written?

    order is a dict with an optional "metafield" (None, or {"value": "..."}).
    expected_external_id is the id from the source of truth for this order, or None
    if we have no external record for it yet (in which case there is nothing to do).
    """
    if not expected_external_id:
        return False
    current = order.get("metafield")
    current_value = current.get("value") if current else None
    return current_value != expected_external_id


def plan_repairs(orders, external_id_lookup):
    """Pure: given orders and a name/id -> external id lookup, return the list of
    (order, expected_external_id) pairs that need a metafieldsSet call."""
    plan = []
    for order in orders:
        expected = external_id_lookup.get(order["name"])
        if needs_repair(order, expected):
            plan.append((order, expected))
    return plan


def orders_missing_link():
    """Orders created in the lookback window, read with their external id metafield."""
    q = "created_at:>-7d"
    cursor = None
    while True:
        data = gql(ORDERS_QUERY, {"cursor": cursor, "q": q})["orders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def set_external_id(order_id, external_id):
    variables = {
        "metafields": [{
            "ownerId": order_id,
            "namespace": METAFIELD_NAMESPACE,
            "key": METAFIELD_KEY,
            "type": "single_line_text_field",
            "value": external_id,
        }]
    }
    result = gql(METAFIELDS_SET, variables)["metafieldsSet"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["metafields"][0]["value"]


def run(external_id_lookup):
    """external_id_lookup maps order name (e.g. "#1001") to the external id it should
    carry, coming from your own system of record. Wire this up to your database or API."""
    repaired = 0
    orders = list(orders_missing_link())
    for order, expected in plan_repairs(orders, external_id_lookup):
        log.warning(
            "Order %s external id metafield %s. %s",
            order["name"],
            "missing" if not order.get("metafield") else "mismatched",
            "would set" if DRY_RUN else "setting",
        )
        if not DRY_RUN:
            set_external_id(order["id"], expected)
        repaired += 1
    log.info("Done. %d order(s) %s.", repaired, "to repair" if DRY_RUN else "repaired")


if __name__ == "__main__":
    # Replace this with a real lookup, for example a query against your order system.
    run(external_id_lookup={})
