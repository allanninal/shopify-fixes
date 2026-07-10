from notify_expired_cards import card_expired, needs_update


def contract(**over):
    base = {
        "status": "ACTIVE",
        "customerPaymentMethod": {
            "id": "gid://shopify/CustomerPaymentMethod/1",
            "revokedAt": None,
            "instrument": {"expiryMonth": 1, "expiryYear": 2025},
        },
    }
    base.update(over)
    return base


def test_card_expired_before_this_month():
    assert card_expired(1, 2025, 2026, 7) is True


def test_card_not_expired_this_month():
    assert card_expired(7, 2026, 2026, 7) is False


def test_card_not_expired_future_year():
    assert card_expired(1, 2027, 2026, 7) is False


def test_card_missing_fields_not_expired():
    assert card_expired(None, None, 2026, 7) is False


def test_needs_update_for_expired_card():
    assert needs_update(contract(), 2026, 7) is True


def test_needs_update_for_revoked_method():
    c = contract(customerPaymentMethod={"id": "pm", "revokedAt": "2026-01-01T00:00:00Z",
                                        "instrument": {"expiryMonth": 1, "expiryYear": 2099}})
    assert needs_update(c, 2026, 7) is True


def test_no_update_when_card_valid():
    c = contract(customerPaymentMethod={"id": "pm", "revokedAt": None,
                                        "instrument": {"expiryMonth": 12, "expiryYear": 2099}})
    assert needs_update(c, 2026, 7) is False


def test_no_update_when_not_active():
    assert needs_update(contract(status="PAUSED"), 2026, 7) is False


def test_no_update_when_no_payment_method():
    assert needs_update(contract(customerPaymentMethod=None), 2026, 7) is False
