from backfill_missed_webhooks import needs_backfill, summarize, to_cents


def order(**over):
    base = {
        "id": "gid://shopify/Order/1",
        "name": "#1001",
        "tags": [],
        "updatedAt": "2026-07-05T12:00:00Z",
        "displayFinancialStatus": "PAID",
        "displayFulfillmentStatus": "UNFULFILLED",
        "cancelledAt": None,
        "totalReceivedSet": {"shopMoney": {"amount": "50.00", "currencyCode": "USD"}},
    }
    base.update(over)
    return base


GAP_START = "2026-07-05T00:00:00Z"
GAP_END = "2026-07-06T00:00:00Z"


def test_to_cents_rounds():
    assert to_cents("50.00") == 5000
    assert to_cents("9.99") == 999


def test_needs_backfill_when_updated_inside_gap_and_untagged():
    assert needs_backfill(order(), GAP_START, GAP_END, "webhook-backfilled") is True


def test_skip_when_updated_before_gap():
    o = order(updatedAt="2026-07-04T23:00:00Z")
    assert needs_backfill(o, GAP_START, GAP_END, "webhook-backfilled") is False


def test_skip_when_updated_after_gap():
    o = order(updatedAt="2026-07-06T01:00:00Z")
    assert needs_backfill(o, GAP_START, GAP_END, "webhook-backfilled") is False


def test_skip_when_already_tagged():
    o = order(tags=["webhook-backfilled"])
    assert needs_backfill(o, GAP_START, GAP_END, "webhook-backfilled") is False


def test_skip_when_no_updated_at():
    o = order(updatedAt=None)
    assert needs_backfill(o, GAP_START, GAP_END, "webhook-backfilled") is False


def test_boundary_timestamps_are_inclusive():
    assert needs_backfill(order(updatedAt=GAP_START), GAP_START, GAP_END, "webhook-backfilled") is True
    assert needs_backfill(order(updatedAt=GAP_END), GAP_START, GAP_END, "webhook-backfilled") is True


def test_summarize_reads_money_in_cents():
    state = summarize(order(totalReceivedSet={"shopMoney": {"amount": "129.99", "currencyCode": "USD"}}))
    assert state["total_received_cents"] == 12999
    assert state["financial_status"] == "PAID"
    assert state["cancelled"] is False
