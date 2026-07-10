from datetime import date

from fix_next_billing_date import (
    expected_next_billing_date,
    decide_realignment,
)


def contract(**over):
    base = {
        "id": "gid://shopify/SubscriptionContract/1",
        "status": "ACTIVE",
        "nextBillingDate": "2026-08-01",
        "createdAt": "2026-06-01T00:00:00Z",
        "billingPolicy": {"interval": "MONTH", "intervalCount": 1},
    }
    base.update(over)
    return base


def test_expected_next_billing_date_walks_whole_intervals():
    origin = date(2026, 1, 1)
    # 30 day months in this model: day 61 (Mar 2) is the second cycle boundary
    result = expected_next_billing_date(origin, "MONTH", 1, date(2026, 3, 1))
    assert result == date(2026, 3, 2)


def test_expected_next_billing_date_before_origin_returns_origin():
    origin = date(2026, 6, 1)
    assert expected_next_billing_date(origin, "MONTH", 1, date(2026, 1, 1)) == origin


def test_no_drift_within_tolerance_returns_none():
    # createdAt 2026-06-01, monthly (30d) cycles land on 2026-07-01 near today.
    c = contract(nextBillingDate="2026-07-01", createdAt="2026-06-01T00:00:00Z")
    assert decide_realignment(c, date(2026, 7, 1)) is None


def test_drift_beyond_tolerance_returns_expected_iso_date():
    # Stored date is stuck a full cycle behind the policy-implied date.
    c = contract(nextBillingDate="2026-07-01", createdAt="2026-06-01T00:00:00Z")
    result = decide_realignment(c, date(2026, 8, 15))
    assert result is not None
    assert result != "2026-07-01"


def test_skip_when_contract_not_active():
    c = contract(status="CANCELLED", nextBillingDate="2026-01-01")
    assert decide_realignment(c, date(2026, 8, 15)) is None


def test_skip_when_billing_policy_missing_fields():
    c = contract(billingPolicy={"interval": None, "intervalCount": None})
    assert decide_realignment(c, date(2026, 8, 15)) is None


def test_skip_when_missing_dates():
    c = contract(nextBillingDate=None)
    assert decide_realignment(c, date(2026, 8, 15)) is None
