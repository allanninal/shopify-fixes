from find_stranded_checkouts import is_stranded, to_cents, checkout_token_from_gid


def checkout(**over):
    base = {
        "id": "gid://shopify/AbandonedCheckout/123",
        "completedAt": "2026-07-09T10:00:00Z",
        "totalPriceSet": {"shopMoney": {"amount": "49.99", "currencyCode": "USD"}},
    }
    base.update(over)
    return base


def test_to_cents_rounds():
    assert to_cents("49.99") == 4999
    assert to_cents("10.00") == 1000


def test_checkout_token_from_gid_extracts_numeric_id():
    assert checkout_token_from_gid("gid://shopify/AbandonedCheckout/123") == "123"


def test_stranded_when_completed_and_no_order():
    assert is_stranded(checkout(), has_matching_order=False) is True


def test_not_stranded_when_order_exists():
    assert is_stranded(checkout(), has_matching_order=True) is False


def test_not_stranded_when_never_completed():
    assert is_stranded(checkout(completedAt=None), has_matching_order=False) is False


def test_not_stranded_when_below_minimum_cents():
    tiny = checkout(totalPriceSet={"shopMoney": {"amount": "0.00", "currencyCode": "USD"}})
    assert is_stranded(tiny, has_matching_order=False, min_cents=1) is False


def test_stranded_respects_custom_minimum():
    small = checkout(totalPriceSet={"shopMoney": {"amount": "0.50", "currencyCode": "USD"}})
    assert is_stranded(small, has_matching_order=False, min_cents=100) is False
    assert is_stranded(small, has_matching_order=False, min_cents=10) is True
