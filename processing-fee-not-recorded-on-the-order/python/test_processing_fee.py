from record_processing_fee import fee_cents_for_order, to_cents


def fee(amount):
    return {"amount": {"amount": amount, "currencyCode": "USD"}}


def txn(fees, kind="SALE", status="SUCCESS"):
    return {"kind": kind, "status": status, "fees": fees}


def order(txns, existing_value=None):
    return {
        "feeMetafield": {"value": existing_value} if existing_value is not None else None,
        "transactions": txns,
    }


def test_to_cents_rounds():
    assert to_cents("1.49") == 149


def test_sums_fee_on_successful_sale():
    assert fee_cents_for_order(order([txn([fee("1.50")])])) == 150


def test_sums_fees_across_capture_and_sale():
    o = order([txn([fee("1.00")], kind="SALE"), txn([fee("0.50")], kind="CAPTURE")])
    assert fee_cents_for_order(o) == 150


def test_ignores_failed_transactions():
    o = order([txn([fee("1.50")], status="FAILURE")])
    assert fee_cents_for_order(o) is None


def test_ignores_refund_transactions():
    o = order([txn([fee("1.50")], kind="REFUND")])
    assert fee_cents_for_order(o) is None


def test_skips_when_already_recorded():
    o = order([txn([fee("1.50")])], existing_value="150")
    assert fee_cents_for_order(o) is None


def test_none_when_no_fee_present():
    o = order([txn([])])
    assert fee_cents_for_order(o) is None


def test_multiple_fees_on_one_transaction():
    o = order([txn([fee("1.00"), fee("0.30")])])
    assert fee_cents_for_order(o) == 130
