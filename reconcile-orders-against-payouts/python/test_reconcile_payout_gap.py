from reconcile_payout_orders import (
    to_cents,
    net_transactions_cents,
    payout_mismatch_cents,
    is_mismatch,
)


def payout(net, payout_id="gid://shopify/ShopifyPaymentsPayout/1"):
    return {"id": payout_id, "status": "PAID", "net": {"amount": net, "currencyCode": "USD"}}


def txn(net, payout_id="gid://shopify/ShopifyPaymentsPayout/1", order_name="#1001"):
    return {
        "associatedPayout": {"id": payout_id},
        "associatedOrder": {"id": "gid://shopify/Order/1", "name": order_name},
        "net": {"amount": net, "currencyCode": "USD"},
    }


def test_to_cents_rounds():
    assert to_cents("50.00") == 5000
    assert to_cents("9.99") == 999


def test_net_transactions_sums_only_matching_payout():
    transactions = [txn("40.00"), txn("10.00"), txn("5.00", payout_id="other")]
    assert net_transactions_cents(transactions, "gid://shopify/ShopifyPaymentsPayout/1") == 5000


def test_no_mismatch_when_balanced():
    p = payout("50.00")
    transactions = [txn("30.00"), txn("20.00")]
    assert payout_mismatch_cents(p, transactions) == 0
    assert is_mismatch(p, transactions) is False


def test_mismatch_when_transaction_missing():
    p = payout("50.00")
    transactions = [txn("30.00")]
    assert payout_mismatch_cents(p, transactions) == 2000
    assert is_mismatch(p, transactions) is True


def test_mismatch_when_transactions_overshoot():
    p = payout("50.00")
    transactions = [txn("30.00"), txn("30.00")]
    assert payout_mismatch_cents(p, transactions) == -1000
    assert is_mismatch(p, transactions) is True


def test_within_tolerance_is_not_a_mismatch():
    p = payout("50.00")
    transactions = [txn("49.99")]
    assert is_mismatch(p, transactions) is False


def test_transactions_from_other_payouts_are_ignored():
    p = payout("50.00")
    transactions = [txn("50.00"), txn("999.00", payout_id="gid://shopify/ShopifyPaymentsPayout/2")]
    assert is_mismatch(p, transactions) is False
