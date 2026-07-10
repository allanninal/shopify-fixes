from flag_stale_unfulfilled import is_stale_unfulfilled, is_on_hold, iso_to_epoch

NOW = iso_to_epoch("2026-07-10T00:00:00Z")


def order(**over):
    base = {
        "displayFulfillmentStatus": "UNFULFILLED",
        "createdAt": "2026-07-01T00:00:00Z",  # 9 days old
        "tags": [],
        "fulfillmentOrders": {"nodes": [{"status": "OPEN"}]},
    }
    base.update(over)
    return base


def test_stale_when_old_and_unfulfilled():
    assert is_stale_unfulfilled(order(), NOW, 3, "fulfillment-overdue") is True


def test_not_stale_when_recent():
    assert is_stale_unfulfilled(order(createdAt="2026-07-09T00:00:00Z"), NOW, 3, "fulfillment-overdue") is False


def test_not_stale_when_already_fulfilled():
    assert is_stale_unfulfilled(order(displayFulfillmentStatus="FULFILLED"), NOW, 3, "fulfillment-overdue") is False


def test_not_stale_when_already_tagged():
    assert is_stale_unfulfilled(order(tags=["fulfillment-overdue"]), NOW, 3, "fulfillment-overdue") is False


def test_not_stale_when_on_hold():
    o = order(fulfillmentOrders={"nodes": [{"status": "ON_HOLD"}]})
    assert is_stale_unfulfilled(o, NOW, 3, "fulfillment-overdue") is False


def test_is_on_hold_detects_held_fulfillment():
    assert is_on_hold(order(fulfillmentOrders={"nodes": [{"status": "OPEN"}, {"status": "ON_HOLD"}]})) is True


def test_not_stale_when_missing_created_at():
    assert is_stale_unfulfilled(order(createdAt=None), NOW, 3, "fulfillment-overdue") is False


def test_exactly_at_sla_is_stale():
    # created exactly 3 days before now
    assert is_stale_unfulfilled(order(createdAt="2026-07-07T00:00:00Z"), NOW, 3, "fulfillment-overdue") is True
