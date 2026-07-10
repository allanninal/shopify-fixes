from capture_authorized import eligible_to_capture, authorization_txn


def order(**over):
    base = {
        "displayFinancialStatus": "AUTHORIZED",
        "totalCapturableSet": {"shopMoney": {"amount": "50.00", "currencyCode": "USD"}},
        "transactions": [{"id": "gid://shopify/OrderTransaction/1", "kind": "AUTHORIZATION", "status": "SUCCESS"}],
    }
    base.update(over)
    return base


def test_eligible_when_authorized_with_amount_and_auth_txn():
    assert eligible_to_capture(order()) is True


def test_skip_when_not_authorized():
    assert eligible_to_capture(order(displayFinancialStatus="PAID")) is False


def test_skip_when_nothing_capturable():
    assert eligible_to_capture(order(totalCapturableSet={"shopMoney": {"amount": "0.00", "currencyCode": "USD"}})) is False


def test_skip_when_no_authorization_transaction():
    assert eligible_to_capture(order(transactions=[{"id": "t", "kind": "SALE", "status": "SUCCESS"}])) is False


def test_authorization_txn_ignores_failed_auth():
    o = order(transactions=[{"id": "t", "kind": "AUTHORIZATION", "status": "FAILURE"}])
    assert authorization_txn(o) is None
