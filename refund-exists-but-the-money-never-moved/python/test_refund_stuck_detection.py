from find_stuck_refunds import moved_cents, is_stuck_refund, to_cents, has_stuck_refund


def txn(amount, status="SUCCESS", kind="REFUND"):
    return {"kind": kind, "status": status,
            "amountSet": {"shopMoney": {"amount": amount, "currencyCode": "USD"}}}


def refund(total, txns):
    return {
        "totalRefundedSet": {"shopMoney": {"amount": total, "currencyCode": "USD"}},
        "transactions": {"nodes": txns},
    }


def test_to_cents_rounds():
    assert to_cents("20.00") == 2000
    assert to_cents("9.99") == 999


def test_moved_cents_counts_only_success():
    txns = [txn("20.00", status="SUCCESS"), txn("20.00", status="FAILURE")]
    assert moved_cents({"transactions": {"nodes": txns}}) == 2000


def test_not_stuck_when_success_matches_claim():
    assert is_stuck_refund(refund("20.00", [txn("20.00")])) is False


def test_stuck_when_transaction_failed():
    assert is_stuck_refund(refund("20.00", [txn("20.00", status="FAILURE")])) is True


def test_stuck_when_transaction_pending():
    assert is_stuck_refund(refund("20.00", [txn("20.00", status="PENDING")])) is True


def test_stuck_when_transaction_error():
    assert is_stuck_refund(refund("20.00", [txn("20.00", status="ERROR")])) is True


def test_stuck_when_no_transactions_at_all():
    assert is_stuck_refund(refund("20.00", [])) is True


def test_not_stuck_when_partial_refund_ties_out():
    assert is_stuck_refund(refund("5.00", [txn("5.00")])) is False


def test_has_stuck_refund_true_when_any_refund_is_stuck():
    order = {"refunds": [refund("20.00", [txn("20.00")]), refund("5.00", [txn("5.00", status="ERROR")])]}
    assert has_stuck_refund(order) is True


def test_has_stuck_refund_false_when_all_refunds_ok():
    order = {"refunds": [refund("20.00", [txn("20.00")])]}
    assert has_stuck_refund(order) is False


def test_has_stuck_refund_false_when_no_refunds():
    assert has_stuck_refund({"refunds": []}) is False
