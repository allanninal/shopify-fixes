from flag_open_chargebacks import needs_flag, has_open_chargeback, disputed_amount_cents, to_cents


def dispute(status="NEEDS_RESPONSE", initiated_as="CHARGEBACK"):
    return {"id": "gid://shopify/ShopifyPaymentsDispute/1", "initiatedAs": initiated_as, "status": status}


def order(financial_status="PAID", disputes=None, tags=None, received="50.00"):
    return {
        "displayFinancialStatus": financial_status,
        "disputes": disputes if disputes is not None else [dispute()],
        "tags": tags or [],
        "totalReceivedSet": {"shopMoney": {"amount": received, "currencyCode": "USD"}},
    }


def test_to_cents_rounds():
    assert to_cents("50.00") == 5000
    assert to_cents("9.99") == 999


def test_has_open_chargeback_true_for_needs_response():
    assert has_open_chargeback(order()) is True


def test_has_open_chargeback_true_for_under_review():
    assert has_open_chargeback(order(disputes=[dispute(status="UNDER_REVIEW")])) is True


def test_has_open_chargeback_false_when_won():
    assert has_open_chargeback(order(disputes=[dispute(status="WON")])) is False


def test_has_open_chargeback_false_for_inquiry_only():
    assert has_open_chargeback(order(disputes=[dispute(initiated_as="INQUIRY")])) is False


def test_needs_flag_true_when_paid_and_disputed_and_untagged():
    assert needs_flag(order(), "chargeback-open") is True


def test_needs_flag_true_when_partially_refunded():
    assert needs_flag(order(financial_status="PARTIALLY_REFUNDED"), "chargeback-open") is True


def test_needs_flag_false_when_no_disputes():
    assert needs_flag(order(disputes=[]), "chargeback-open") is False


def test_needs_flag_false_when_dispute_resolved():
    assert needs_flag(order(disputes=[dispute(status="WON")]), "chargeback-open") is False


def test_needs_flag_false_when_already_tagged():
    assert needs_flag(order(tags=["chargeback-open"]), "chargeback-open") is False


def test_needs_flag_false_when_financial_status_not_relevant():
    assert needs_flag(order(financial_status="REFUNDED"), "chargeback-open") is False


def test_disputed_amount_cents_reads_shop_money():
    assert disputed_amount_cents(order(received="123.45")) == 12345
