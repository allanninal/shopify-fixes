"""Retry Shopify subscription billing attempts that failed, on a safe backoff.

A recurring charge can fail for many ordinary reasons: an expired card, a bank
that declined the charge, a payment gateway timeout. Shopify records the failure
on the SubscriptionContract as lastPaymentStatus FAILED, but nothing retries it
on its own. This job finds active contracts whose last payment failed, looks at
the contract's own billingAttempts history to work out how long it has been
failing, and creates a new billing attempt once the right number of days have
passed, following a backoff schedule so we do not hammer a card that just failed.
Read the billing history, decide with a pure function, then only write
(subscriptionBillingAttemptCreate) when it is due. Run on a schedule, for
example daily. Safe to run again and again because a due contract that already
has a fresh pending attempt is left alone.
"""
import os
import logging
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("retry_failed_billing")

SHOP = os.environ["SHOPIFY_SHOP"]
TOKEN = os.environ["SHOPIFY_ACCESS_TOKEN"]
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2025-01")
ENDPOINT = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() == "true"

# Days to wait after the most recent attempt before trying again. The index in
# this list is the retry number: the 1st retry waits 1 day, the 2nd waits 3
# days, the 3rd waits 7 days. After that we stop retrying and leave the
# contract for a human, since a card that has failed four times in under two
# weeks needs a person, not another automatic charge.
BACKOFF_SCHEDULE_DAYS = [1, 3, 7]
MAX_RETRIES = len(BACKOFF_SCHEDULE_DAYS)

CONTRACTS_QUERY = """
query($cursor: String) {
  subscriptionContracts(first: 25, after: $cursor, query: "status:ACTIVE") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      lastPaymentStatus
      customer { defaultEmailAddress { emailAddress } }
      billingAttempts(first: 10, reverse: true) {
        nodes { id createdAt completedAt }
      }
    }
  }
}"""

RETRY_MUTATION = """
mutation($contractId: ID!, $idempotencyKey: String!) {
  subscriptionBillingAttemptCreate(
    subscriptionContractId: $contractId
    subscriptionBillingAttemptInput: { idempotencyKey: $idempotencyKey }
  ) {
    subscriptionBillingAttempt { id }
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


def _parse_iso(value):
    if not value:
        return None
    return value.replace("Z", "+00:00")


def failed_attempt_count(billing_attempts):
    """How many attempts in a row, most recent first, never completed.

    An attempt with completedAt set was successful and produced an order, so a
    run of failures stops at the first completed attempt. billing_attempts must
    already be ordered most recent first (reverse: true on the query).
    """
    count = 0
    for attempt in billing_attempts or []:
        if attempt.get("completedAt"):
            break
        count += 1
    return count


def days_between(earlier_iso, later_iso):
    """Whole days between two ISO 8601 timestamps, later minus earlier."""
    from datetime import datetime

    earlier = datetime.fromisoformat(_parse_iso(earlier_iso))
    later = datetime.fromisoformat(_parse_iso(later_iso))
    return (later - earlier).total_seconds() / 86400.0


def retry_decision(contract, now_iso):
    """Pure decision: should we fire another billing attempt for this contract, right now?

    Rules, in order:
      1. Only contracts whose lastPaymentStatus is FAILED are candidates. A
         contract that is paid up has nothing to retry.
      2. We count the unbroken run of failed attempts from most recent
         backwards. If that count is already at or beyond MAX_RETRIES, we stop
         retrying automatically and leave it for a human.
      3. We look at how many whole days have passed since the most recent
         attempt. The schedule says how long to wait before the next retry
         (schedule[failed_count - 1], since failed_count is 1-indexed by the
         time we get here). If not enough days have passed yet, it is not due.
      4. If there is no billing attempt history at all, there is nothing to
         retry against, so we skip.

    No I/O happens in this function, so it is fully unit testable.
    """
    if contract.get("lastPaymentStatus") != "FAILED":
        return False

    attempts = contract.get("billingAttempts") or []
    failed_count = failed_attempt_count(attempts)
    if failed_count == 0 or failed_count > MAX_RETRIES:
        return False

    last_attempt = attempts[0]
    last_created_at = last_attempt.get("createdAt")
    if not last_created_at:
        return False

    wait_days = BACKOFF_SCHEDULE_DAYS[failed_count - 1]
    elapsed_days = days_between(last_created_at, now_iso)
    return elapsed_days >= wait_days


def failed_contracts():
    cursor = None
    while True:
        data = gql(CONTRACTS_QUERY, {"cursor": cursor})["subscriptionContracts"]
        for node in data["nodes"]:
            yield node
        if not data["pageInfo"]["hasNextPage"]:
            return
        cursor = data["pageInfo"]["endCursor"]


def retry_billing(contract_id, idempotency_key):
    result = gql(RETRY_MUTATION, {"contractId": contract_id, "idempotencyKey": idempotency_key})[
        "subscriptionBillingAttemptCreate"
    ]
    if result["userErrors"]:
        raise RuntimeError(result["userErrors"])
    return result["subscriptionBillingAttempt"]["id"]


def run():
    from datetime import datetime, timezone
    import uuid

    now_iso = datetime.now(timezone.utc).isoformat()
    retried = 0
    for contract in failed_contracts():
        if not retry_decision(contract, now_iso):
            continue
        contract_id = contract["id"]
        idempotency_key = f"dunning-retry-{contract_id.rsplit('/', 1)[-1]}-{uuid.uuid4().hex[:8]}"
        log.info(
            "Contract %s is due for a retry. %s",
            contract_id,
            "would retry" if DRY_RUN else "retrying",
        )
        if not DRY_RUN:
            retry_billing(contract_id, idempotency_key)
        retried += 1
    log.info("Done. %d contract(s) %s.", retried, "to retry" if DRY_RUN else "retried")


if __name__ == "__main__":
    run()
