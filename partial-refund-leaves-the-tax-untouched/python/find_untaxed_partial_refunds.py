"""Flag (and optionally fix) Shopify partial refunds that gave back the item but
kept the tax.

A partial refund that only sets a refund line item amount, with no matching
orderAdjustment or transaction for tax, leaves the tax portion sitting on the
order. The customer paid tax on money they no longer owe. This job walks
recent refunds, works out the tax that *should* have come back for each set of
refunded line items (proportional to what the order originally charged), compares
it to the tax Shopify actually refunded, and when the gap is real it issues a
follow-up refund for the missing tax only. Read-only unless DRY_RUN is false.
Run on a schedule. Safe to run again and again, because a refund that already
ties out is left alone.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("find_untaxed_partial_refunds")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "14"))
MIN_GAP_CENTS = int(os.environ.get("MIN_GAP_CENTS", "2"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ORDERS_QUERY = """
query($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      currentTotalTaxSet { shopMoney { amount } }
      currentSubtotalLineItemsQuantity
      lineItems(first: 100) {
        nodes {
          id
          quantity
          originalUnitPriceSet { shopMoney { amount } }
          taxLines { priceSet { shopMoney { amount } } }
        }
      }
      refunds(first: 20) {
        id
        createdAt
        totalRefundedSet { shopMoney { amount } }
        refundLineItems(first: 50) {
          nodes {
            quantity
            lineItem { id }
            subtotalSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
          }
        }
        transactions(first: 10) {
          nodes { kind status amountSet { shopMoney { amount } } }
        }
      }
    }
  }
}"""

REFUND_CREATE = """
mutation($input: RefundInput!) {
  refundCreate(input: $input) {
    refund { id totalRefundedSet { shopMoney { amount } } }
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


def line_item_tax_rate(line_item):
    """The tax the order originally charged on one unit, as a fraction of the unit price.

    Returns 0.0 when the line item has no price (avoids a division by zero) or
    carries no tax lines (a tax-exempt product, for example).
    """
    unit_price = to_cents(line_item["originalUnitPriceSet"]["shopMoney"]["amount"])
    if unit_price <= 0:
        return 0.0
    tax_cents = sum(
        to_cents(t["priceSet"]["shopMoney"]["amount"]) for t in (line_item.get("taxLines") or [])
    )
    quantity = line_item.get("quantity") or 1
    return tax_cents / (unit_price * quantity)


def expected_tax_cents_for_refund(refund, line_items_by_id):
    """The tax that should be refunded for one refund, in cents.

    For every refunded line item we take its refunded subtotal (what the
    customer got back for the goods) and apply the original tax rate for that
    line item. This mirrors how Shopify computed the tax in the first place,
    so a refund that already includes tax will match and one that skipped it
    will not.
    """
    total = 0.0
    for rli in refund.get("refundLineItems", {}).get("nodes", []):
        line_item = line_items_by_id.get(rli["lineItem"]["id"])
        if line_item is None:
            continue
        refunded_subtotal_cents = to_cents(rli["subtotalSet"]["shopMoney"]["amount"])
        total += refunded_subtotal_cents * line_item_tax_rate(line_item)
    return total


def actual_tax_refunded_cents(refund):
    return sum(
        to_cents(rli["totalTaxSet"]["shopMoney"]["amount"])
        for rli in refund.get("refundLineItems", {}).get("nodes", [])
    )


def untaxed_refund_gap_cents(refund, line_items_by_id, min_gap_cents=MIN_GAP_CENTS):
    """Pure decision function. Returns the missing tax in cents, or 0 if none is owed.

    A gap only counts when it clears ``min_gap_cents``, so rounding noise of a
    cent or two never triggers a correction. Never returns a negative number:
    if the refund already gave back more tax than expected, that is not this
    job's problem to fix.
    """
    if not refund.get("refundLineItems", {}).get("nodes"):
        return 0
    expected = expected_tax_cents_for_refund(refund, line_items_by_id)
    actual = actual_tax_refunded_cents(refund)
    gap = round(expected - actual)
    if gap < min_gap_cents:
        return 0
    return gap


def order_line_items_by_id(order):
    return {li["id"]: li for li in order["lineItems"]["nodes"]}


def cents_to_amount(cents):
    return f"{cents / 100:.2f}"


def refund_missing_tax(order_id, gap_cents):
    refund_input = {
        "orderId": order_id,
        "note": "Automatic correction: tax portion missed on an earlier partial refund",
        "transactions": [
            {
                "orderId": order_id,
                "kind": "REFUND",
                "gateway": "manual",
                "amount": cents_to_amount(gap_cents),
            }
        ],
    }
    result = gql(REFUND_CREATE, {"input": refund_input})["refundCreate"]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["refund"]


def recent_orders_with_refunds():
    q = f"created_at:>-{LOOKBACK_DAYS}d AND financial_status:partially_refunded"
    cursor = None
    while True:
        data = gql(ORDERS_QUERY, {"cursor": cursor, "q": q})["orders"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    fixed = 0
    for order in recent_orders_with_refunds():
        line_items_by_id = order_line_items_by_id(order)
        for refund in order.get("refunds", []):
            gap_cents = untaxed_refund_gap_cents(refund, line_items_by_id)
            if gap_cents <= 0:
                continue
            log.warning(
                "Order %s refund %s is missing %s of tax. %s",
                order["name"], refund["id"], cents_to_amount(gap_cents),
                "would refund" if DRY_RUN else "refunding",
            )
            if not DRY_RUN:
                refund_missing_tax(order["id"], gap_cents)
            fixed += 1
    log.info("Done. %d refund(s) %s.", fixed, "to correct" if DRY_RUN else "corrected")


if __name__ == "__main__":
    run()
