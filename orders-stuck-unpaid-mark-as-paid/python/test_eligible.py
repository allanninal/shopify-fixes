from mark_paid import eligible_to_mark


def order(**over):
    base = {"canMarkAsPaid": True, "displayFinancialStatus": "PENDING", "tags": ["paid-externally"]}
    base.update(over)
    return base


def test_eligible_when_pending_taggable_and_can_mark():
    assert eligible_to_mark(order(), "paid-externally") is True


def test_skip_when_cannot_mark():
    assert eligible_to_mark(order(canMarkAsPaid=False), "paid-externally") is False


def test_skip_when_already_paid():
    assert eligible_to_mark(order(displayFinancialStatus="PAID"), "paid-externally") is False


def test_skip_without_tag():
    assert eligible_to_mark(order(tags=[]), "paid-externally") is False
