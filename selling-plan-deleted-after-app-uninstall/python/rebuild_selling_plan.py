"""Rebuild a Shopify selling plan group an uninstalled app took with it.

When a subscriptions app owns a SellingPlanGroup and the merchant uninstalls
that app, Shopify deletes every selling plan group the app owns. The product
survives, but productVariants().sellingPlanGroupsCount drops to zero, so the
subscribe and save option silently disappears from checkout. This scans
products that are supposed to be subscribable (tagged), finds the ones that
lost their selling plan group, recreates a merchant-owned replacement with an
equivalent policy, and reattaches it with sellingPlanGroupAddProducts. Safe
to run again and again: it only acts on products that both carry the tag and
currently have zero selling plan groups.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("rebuild_selling_plan")

SHOP = os.environ.get("SHOPIFY_SHOP", "example.myshopify.com")
TOKEN = os.environ.get("SHOPIFY_ACCESS_TOKEN", "shpat_dummy")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
SUBSCRIBABLE_TAG = os.environ.get("SUBSCRIBABLE_TAG", "subscribe-and-save")
PLAN_NAME = os.environ.get("PLAN_NAME", "Subscribe and save")
DISCOUNT_PERCENT = float(os.environ.get("DISCOUNT_PERCENT", "10"))
DELIVERY_INTERVAL = os.environ.get("DELIVERY_INTERVAL", "MONTH")
DELIVERY_INTERVAL_COUNT = int(os.environ.get("DELIVERY_INTERVAL_COUNT", "1"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

PRODUCTS_QUERY = """
query($cursor: String, $q: String!) {
  products(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title tags
      sellingPlanGroupsCount { count }
      variants(first: 1) { nodes { id } }
    }
  }
}"""

GROUP_CREATE = """
mutation($input: SellingPlanGroupInput!) {
  sellingPlanGroupCreate(input: $input) {
    sellingPlanGroup { id name }
    userErrors { field message }
  }
}"""

GROUP_ADD_PRODUCTS = """
mutation($id: ID!, $productIds: [ID!]!) {
  sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
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


def needs_selling_plan(product, required_tag):
    """Pure decision: does this product need its selling plan group rebuilt?

    True only when the product carries the confirmation tag (it was meant to
    be subscribable) and its current selling plan group count is zero, which
    is what an app-uninstall deletion leaves behind. Any product that still
    has a group, or was never tagged as subscribable, is left alone.
    """
    if required_tag not in (product.get("tags") or []):
        return False
    count = (product.get("sellingPlanGroupsCount") or {}).get("count", 0)
    return count == 0


def discount_minor_units(price_cents, percent):
    """Compute the discounted price in minor units (cents) for a given percent off.

    Kept as integer math throughout so the result never suffers floating
    point drift, then rounded to the nearest cent.
    """
    return round(price_cents * (100 - percent) / 100)


def selling_plan_group_input(name, percent, interval, interval_count):
    """Build the SellingPlanGroupInput payload for a simple recurring discount plan.

    Pure builder, no I/O, so it is trivial to unit test the shape of what we
    would send before ever calling Shopify.
    """
    return {
        "name": name,
        "merchantCode": name.lower().replace(" ", "-"),
        "options": ["Delivery frequency"],
        "sellingPlansToCreate": [
            {
                "name": f"Delivered every {interval_count} {interval.lower()}(s)",
                "options": [f"Every {interval_count} {interval.lower()}(s)"],
                "billingPolicy": {
                    "recurring": {
                        "interval": interval,
                        "intervalCount": interval_count,
                    }
                },
                "deliveryPolicy": {
                    "recurring": {
                        "interval": interval,
                        "intervalCount": interval_count,
                    }
                },
                "pricingPolicies": [
                    {
                        "fixed": {
                            "adjustmentType": "PERCENTAGE",
                            "adjustmentValue": {"percentage": percent},
                        }
                    }
                ],
            }
        ],
    }


def create_group(name, percent, interval, interval_count):
    payload = selling_plan_group_input(name, percent, interval, interval_count)
    result = gql(GROUP_CREATE, {"input": payload})["sellingPlanGroupCreate"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["sellingPlanGroup"]["id"]


def attach_group(group_id, product_ids):
    result = gql(GROUP_ADD_PRODUCTS, {"id": group_id, "productIds": product_ids})[
        "sellingPlanGroupAddProducts"
    ]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])


def subscribable_products():
    q = f"tag:{SUBSCRIBABLE_TAG}"
    cursor = None
    while True:
        data = gql(PRODUCTS_QUERY, {"cursor": cursor, "q": q})["products"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    broken = [p for p in subscribable_products() if needs_selling_plan(p, SUBSCRIBABLE_TAG)]
    if not broken:
        log.info("Done. 0 product(s) needed a rebuilt selling plan group.")
        return

    log.info(
        "%d product(s) lost their selling plan group. %s",
        len(broken),
        "would rebuild" if DRY_RUN else "rebuilding",
    )
    for product in broken:
        log.info("  - %s (%s)", product["title"], product["id"])

    if DRY_RUN:
        log.info("Done. %d product(s) to rebuild.", len(broken))
        return

    group_id = create_group(PLAN_NAME, DISCOUNT_PERCENT, DELIVERY_INTERVAL, DELIVERY_INTERVAL_COUNT)
    attach_group(group_id, [p["id"] for p in broken])
    log.info("Done. %d product(s) reattached to %s.", len(broken), group_id)


if __name__ == "__main__":
    run()
