from find_currency_mismatch import needs_review, implied_rate, to_cents


def totals(shop_amount, shop_ccy, presentment_amount, presentment_ccy):
    return {
        "shopMoney": {"amount": shop_amount, "currencyCode": shop_ccy},
        "presentmentMoney": {"amount": presentment_amount, "currencyCode": presentment_ccy},
    }


def order(total_received, tags=None):
    return {"totalReceivedSet": total_received, "tags": tags or []}


def test_to_cents_rounds():
    assert to_cents("50.00") == 5000
    assert to_cents("9.99") == 999


def test_implied_rate_none_when_shop_side_zero():
    assert implied_rate(0, 5000) is None


def test_implied_rate_computes_ratio():
    # 100 GBP presentment for 128 USD settlement -> ~0.78 GBP per USD
    assert round(implied_rate(12800, 10000), 2) == 0.78


def test_no_review_when_same_currency_and_amounts_match():
    o = order(totals("50.00", "USD", "50.00", "USD"))
    assert needs_review(o, "USD", 0.01, 100) is False


def test_review_when_settlement_currency_is_not_the_expected_one():
    # shop settles in EUR but the store expects USD
    o = order(totals("45.00", "EUR", "50.00", "USD"))
    assert needs_review(o, "USD", 0.01, 100) is True


def test_review_when_same_currency_but_amounts_differ():
    # both say USD but the numbers do not match, a broken conversion
    o = order(totals("50.00", "USD", "48.00", "USD"))
    assert needs_review(o, "USD", 0.01, 100) is True


def test_no_review_when_rate_is_sane():
    # 100 USD settled for 92 EUR presented, plausible FX rate
    o = order(totals("100.00", "USD", "92.00", "EUR"))
    assert needs_review(o, "USD", 0.01, 100) is False


def test_review_when_rate_is_absurd():
    # 1000 USD settled for 1 EUR presented, an obviously broken read
    o = order(totals("1000.00", "USD", "1.00", "EUR"))
    assert needs_review(o, "USD", 0.01, 100) is True


def test_review_when_presentment_amount_missing():
    o = order(totals("100.00", "USD", "0", "EUR"))
    assert needs_review(o, "USD", 0.01, 100) is True


def test_no_review_when_currency_fields_missing():
    o = order({"shopMoney": {}, "presentmentMoney": {}})
    assert needs_review(o, "USD", 0.01, 100) is False
