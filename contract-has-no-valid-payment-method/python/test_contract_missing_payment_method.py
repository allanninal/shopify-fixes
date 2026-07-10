from find_contracts_missing_payment_method import (
    has_no_valid_payment_method,
    needs_tag,
)


def contract(**over):
    base = {
        "status": "ACTIVE",
        "lastPaymentStatus": "PENDING",
        "customerPaymentMethod": {"id": "gid://shopify/CustomerPaymentMethod/1", "revokedAt": None},
        "tags": [],
    }
    base.update(over)
    return base


def test_flags_when_last_payment_status_says_no_method():
    c = contract(lastPaymentStatus="NO_PAYMENT_METHOD")
    assert has_no_valid_payment_method(c) is True


def test_flags_when_method_is_missing():
    c = contract(customerPaymentMethod=None)
    assert has_no_valid_payment_method(c) is True


def test_flags_when_method_was_revoked():
    c = contract(customerPaymentMethod={"id": "gid://shopify/CustomerPaymentMethod/1", "revokedAt": "2026-06-01T00:00:00Z"})
    assert has_no_valid_payment_method(c) is True


def test_ok_when_method_present_and_not_revoked():
    c = contract()
    assert has_no_valid_payment_method(c) is False


def test_ignores_cancelled_contracts():
    c = contract(status="CANCELLED", customerPaymentMethod=None)
    assert has_no_valid_payment_method(c) is False


def test_ignores_paused_contracts():
    c = contract(status="PAUSED", lastPaymentStatus="NO_PAYMENT_METHOD")
    assert has_no_valid_payment_method(c) is False


def test_needs_tag_true_when_broken_and_untagged():
    c = contract(customerPaymentMethod=None, tags=[])
    assert needs_tag(c, "needs-payment-method") is True


def test_needs_tag_false_when_already_tagged():
    c = contract(customerPaymentMethod=None, tags=["needs-payment-method"])
    assert needs_tag(c, "needs-payment-method") is False


def test_needs_tag_false_when_contract_is_healthy():
    c = contract()
    assert needs_tag(c, "needs-payment-method") is False
