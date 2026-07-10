from find_duplicate_renewals import find_duplicate_orders, billing_cycle_key, to_cents


def attempt(order_id, name, origin, amount="29.00", tags=None):
    return {
        "id": f"gid://shopify/SubscriptionBillingAttempt/{order_id}",
        "ready": True,
        "idempotencyKey": f"key-{order_id}",
        "originTime": origin,
        "order": {
            "id": f"gid://shopify/Order/{order_id}",
            "name": name,
            "tags": tags or [],
            "totalPriceSet": {"shopMoney": {"amount": amount, "currencyCode": "USD"}},
        },
    }


def contract(attempts):
    return {"id": "gid://shopify/SubscriptionContract/1", "billingAttempts": attempts}


def test_to_cents_rounds():
    assert to_cents("29.00") == 2900
    assert to_cents("9.99") == 999


def test_billing_cycle_key_truncates_to_day():
    a = attempt(1, "#1001", "2026-07-01T08:00:00Z")
    assert billing_cycle_key(a) == "2026-07-01"


def test_no_duplicates_for_single_attempt_per_cycle():
    c = contract([
        attempt(1, "#1001", "2026-06-01T08:00:00Z"),
        attempt(2, "#1002", "2026-07-01T08:00:00Z"),
    ])
    assert find_duplicate_orders(c, "duplicate-renewal") == []


def test_second_attempt_same_day_is_a_duplicate():
    c = contract([
        attempt(1, "#1001", "2026-07-01T08:00:00Z"),
        attempt(2, "#1002", "2026-07-01T08:14:00Z"),
    ])
    dups = find_duplicate_orders(c, "duplicate-renewal")
    assert len(dups) == 1
    assert dups[0]["order_id"] == "gid://shopify/Order/2"
    assert dups[0]["amount_cents"] == 2900


def test_first_attempt_in_a_cycle_is_never_flagged():
    c = contract([
        attempt(1, "#1001", "2026-07-01T08:00:00Z"),
        attempt(2, "#1002", "2026-07-01T08:14:00Z"),
        attempt(3, "#1003", "2026-07-01T09:00:00Z"),
    ])
    dups = find_duplicate_orders(c, "duplicate-renewal")
    order_ids = [d["order_id"] for d in dups]
    assert "gid://shopify/Order/1" not in order_ids
    assert len(dups) == 2


def test_attempts_without_an_order_are_ignored():
    failed = attempt(1, "#1001", "2026-07-01T08:00:00Z")
    failed["order"] = None
    ok = attempt(2, "#1002", "2026-07-01T08:14:00Z")
    c = contract([failed, ok])
    assert find_duplicate_orders(c, "duplicate-renewal") == []


def test_already_tagged_duplicate_is_skipped():
    c = contract([
        attempt(1, "#1001", "2026-07-01T08:00:00Z"),
        attempt(2, "#1002", "2026-07-01T08:14:00Z", tags=["duplicate-renewal"]),
    ])
    assert find_duplicate_orders(c, "duplicate-renewal") == []


def test_different_cycles_are_each_allowed_one_charge():
    c = contract([
        attempt(1, "#1001", "2026-05-01T08:00:00Z"),
        attempt(2, "#1002", "2026-06-01T08:00:00Z"),
        attempt(3, "#1003", "2026-07-01T08:00:00Z"),
    ])
    assert find_duplicate_orders(c, "duplicate-renewal") == []
