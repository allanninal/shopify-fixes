from flag_test_orders import is_test_order, needs_tag, uses_bogus_gateway, to_cents


def order(**over):
    base = {
        "test": False,
        "tags": [],
        "transactions": [{"gateway": "shopify_payments"}],
        "currentTotalPriceSet": {"shopMoney": {"amount": "50.00", "currencyCode": "USD"}},
    }
    base.update(over)
    return base


def test_to_cents_rounds():
    assert to_cents("50.00") == 5000
    assert to_cents("9.99") == 999


def test_uses_bogus_gateway_true():
    assert uses_bogus_gateway([{"gateway": "bogus"}]) is True


def test_uses_bogus_gateway_case_insensitive():
    assert uses_bogus_gateway([{"gateway": "Bogus_Gateway"}]) is True


def test_uses_bogus_gateway_false_for_real_gateway():
    assert uses_bogus_gateway([{"gateway": "shopify_payments"}]) is False


def test_uses_bogus_gateway_handles_missing_transactions():
    assert uses_bogus_gateway(None) is False


def test_is_test_order_true_when_test_flag_set():
    assert is_test_order(order(test=True)) is True


def test_is_test_order_true_when_bogus_gateway_used():
    assert is_test_order(order(transactions=[{"gateway": "bogus"}])) is True


def test_is_test_order_false_for_real_order():
    assert is_test_order(order()) is False


def test_needs_tag_true_for_untagged_test_order():
    assert needs_tag(order(test=True), "test-order") is True


def test_needs_tag_false_when_already_tagged():
    assert needs_tag(order(test=True, tags=["test-order"]), "test-order") is False


def test_needs_tag_false_for_live_order():
    assert needs_tag(order(), "test-order") is False
