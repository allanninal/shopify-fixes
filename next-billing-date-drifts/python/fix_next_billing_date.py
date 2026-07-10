"""Realign a Shopify subscription contract's nextBillingDate when it drifts
from the date the billing policy actually implies.

The stored nextBillingDate on a SubscriptionContract should always be the
origin date plus a whole number of intervals (for example every 30 days, or
every 1 month). A paused-then-resumed contract, a manually edited date, or a
missed billing cycle can leave nextBillingDate sitting on a date the policy
never produces. This walks each active contract, recomputes the date the
policy implies, and calls subscriptionBillingCycleScheduleEdit to move the
next cycle back onto schedule when it drifts past a small tolerance.
Read only apart from the one write. Run on a schedule. Safe to run again
and again.
"""
import os
import logging
from datetime import datetime, timezone, date

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("fix_next_billing_date")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
DRIFT_TOLERANCE_DAYS = int(os.environ.get("DRIFT_TOLERANCE_DAYS", "1"))
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

ACTIVE_STATUSES = {"ACTIVE"}

# Shopify's billingPolicy.interval values.
DAY_LENGTHS = {"DAY": 1, "WEEK": 7, "MONTH": 30, "YEAR": 365}

CONTRACTS_QUERY = """
query($cursor: String) {
  subscriptionContracts(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      status
      nextBillingDate
      createdAt
      billingPolicy { interval intervalCount }
    }
  }
}"""

SET_NEXT_BILLING_DATE = """
mutation($contractId: ID!, $date: DateTime!) {
  subscriptionContractSetNextBillingDate(contractId: $contractId, date: $date) {
    contract { id nextBillingDate }
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


def _parse_date(value):
    """Accept a date or datetime string and return a date object."""
    text = value[:10]
    return date.fromisoformat(text)


def expected_next_billing_date(origin_date, interval, interval_count, today):
    """Walk forward from the origin in whole intervals and return the first
    cycle date that is on or after today. Pure: no I/O, no now() lookups.
    """
    step_days = DAY_LENGTHS.get(interval)
    if not step_days or interval_count <= 0:
        return None
    span = step_days * interval_count
    origin_ordinal = origin_date.toordinal()
    today_ordinal = today.toordinal()
    if today_ordinal <= origin_ordinal:
        return origin_date
    elapsed = today_ordinal - origin_ordinal
    cycles_passed = elapsed // span
    candidate_ordinal = origin_ordinal + cycles_passed * span
    if candidate_ordinal < today_ordinal:
        candidate_ordinal += span
    return date.fromordinal(candidate_ordinal)


def decide_realignment(contract, today):
    """Pure decision function. Given a contract dict and a reference today
    date, return the ISO date string to write, or None if nothing to do.
    """
    if contract.get("status") not in ACTIVE_STATUSES:
        return None

    policy = contract.get("billingPolicy") or {}
    interval = policy.get("interval")
    interval_count = policy.get("intervalCount")
    if not interval or not interval_count:
        return None

    stored_raw = contract.get("nextBillingDate")
    origin_raw = contract.get("createdAt")
    if not stored_raw or not origin_raw:
        return None

    stored = _parse_date(stored_raw)
    origin = _parse_date(origin_raw)

    expected = expected_next_billing_date(origin, interval, interval_count, today)
    if expected is None:
        return None

    drift_days = abs((stored - expected).days)
    if drift_days <= DRIFT_TOLERANCE_DAYS:
        return None

    return expected.isoformat()


def set_next_billing_date(contract_id, iso_date):
    result = gql(SET_NEXT_BILLING_DATE, {"contractId": contract_id, "date": iso_date})[
        "subscriptionContractSetNextBillingDate"
    ]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["contract"]["nextBillingDate"]


def active_contracts():
    cursor = None
    while True:
        data = gql(CONTRACTS_QUERY, {"cursor": cursor})["subscriptionContracts"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def run():
    today = datetime.now(timezone.utc).date()
    fixed = 0
    for contract in active_contracts():
        target = decide_realignment(contract, today)
        if target is None:
            continue
        log.info(
            "Contract %s drifted. stored=%s expected=%s. %s",
            contract["id"], contract.get("nextBillingDate"), target,
            "would realign" if DRY_RUN else "realigning",
        )
        if not DRY_RUN:
            set_next_billing_date(contract["id"], target)
        fixed += 1
    log.info("Done. %d contract(s) %s.", fixed, "to realign" if DRY_RUN else "realigned")


if __name__ == "__main__":
    run()
