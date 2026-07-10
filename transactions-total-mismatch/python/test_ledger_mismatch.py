from find_ledger_mismatch import net_captured_cents, is_mismatch, to_cents


def txn(amount, kind="SALE", status="SUCCESS"):
    return {"kind": kind, "status": status,
            "amountSet": {"shopMoney": {"amount": amount, "currencyCode": "USD"}}}


def order(received, txns, tags=None):
    return {
        "totalReceivedSet": {"shopMoney": {"amount": received, "currencyCode": "USD"}},
        "transactions": txns,
        "tags": tags or [],
    }


def test_to_cents_rounds():
    assert to_cents("50.00") == 5000
    assert to_cents("9.99") == 999


def test_net_captured_sums_charges():
    assert net_captured_cents([txn("50.00"), txn("20.00", kind="CAPTURE")]) == 7000


def test_net_captured_subtracts_refunds():
    assert net_captured_cents([txn("50.00"), txn("10.00", kind="REFUND")]) == 4000


def test_net_captured_ignores_failed():
    assert net_captured_cents([txn("50.00"), txn("50.00", status="FAILURE")]) == 5000


def test_no_mismatch_when_balanced():
    assert is_mismatch(order("40.00", [txn("50.00"), txn("10.00", kind="REFUND")])) is False


def test_mismatch_when_refund_not_reflected():
    # received says 50 but a refund of 10 already went out -> net 40 != 50
    assert is_mismatch(order("50.00", [txn("50.00"), txn("10.00", kind="REFUND")])) is True


def test_mismatch_when_capture_missing():
    assert is_mismatch(order("50.00", [])) is True
