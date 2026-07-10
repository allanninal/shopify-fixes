from find_duplicate_charges import duplicate_sale_transactions


def txn(amount, kind="SALE", status="SUCCESS", tid="t"):
    return {"id": tid, "kind": kind, "status": status,
            "amountSet": {"shopMoney": {"amount": amount, "currencyCode": "USD"}}}


def test_no_duplicates_when_single_charge():
    assert duplicate_sale_transactions([txn("50.00")]) == []


def test_finds_one_duplicate_of_same_amount():
    extras = duplicate_sale_transactions([txn("50.00", tid="a"), txn("50.00", tid="b")])
    assert [t["id"] for t in extras] == ["b"]


def test_different_amounts_are_not_duplicates():
    assert duplicate_sale_transactions([txn("50.00"), txn("20.00")]) == []


def test_ignores_failed_and_refund_transactions():
    txns = [txn("50.00", tid="a"),
            txn("50.00", status="FAILURE", tid="b"),
            txn("50.00", kind="REFUND", tid="c")]
    assert duplicate_sale_transactions(txns) == []


def test_two_duplicates_of_same_amount():
    extras = duplicate_sale_transactions([txn("9.99", tid="a"), txn("9.99", tid="b"), txn("9.99", tid="c")])
    assert [t["id"] for t in extras] == ["b", "c"]
