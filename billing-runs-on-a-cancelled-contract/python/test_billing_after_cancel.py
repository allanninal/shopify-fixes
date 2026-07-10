from flag_attempts_after_cancel import attempt_ran_after_cancel, attempts_needing_review


def contract(status="CANCELLED", cancelled_at="2026-06-01T00:00:00Z", attempts=None):
    return {
        "id": "gid://shopify/SubscriptionContract/1",
        "status": status,
        "cancelledAt": cancelled_at,
        "billingAttempts": {"nodes": attempts or []},
    }


def attempt(created_at, ready=True, order=None):
    return {"id": "gid://shopify/SubscriptionBillingAttempt/1",
            "createdAt": created_at, "ready": ready, "order": order}


def test_flags_order_created_after_cancel():
    c = contract()
    a = attempt("2026-06-02T00:00:00Z", order={"id": "gid://shopify/Order/1", "name": "#1001", "tags": []})
    assert attempt_ran_after_cancel(c, a) is True


def test_flags_pending_attempt_after_cancel_even_without_order_yet():
    c = contract()
    a = attempt("2026-06-02T00:00:00Z", ready=False, order=None)
    assert attempt_ran_after_cancel(c, a) is True


def test_ignores_attempt_before_cancel():
    c = contract()
    a = attempt("2026-05-20T00:00:00Z", order={"id": "gid://shopify/Order/1", "name": "#1001", "tags": []})
    assert attempt_ran_after_cancel(c, a) is False


def test_ignores_active_contract():
    c = contract(status="ACTIVE")
    a = attempt("2026-06-02T00:00:00Z", order={"id": "gid://shopify/Order/1", "name": "#1001", "tags": []})
    assert attempt_ran_after_cancel(c, a) is False


def test_ignores_contract_without_cancelled_at():
    c = contract(cancelled_at=None)
    a = attempt("2026-06-02T00:00:00Z", order={"id": "gid://shopify/Order/1", "name": "#1001", "tags": []})
    assert attempt_ran_after_cancel(c, a) is False


def test_ignores_resolved_attempt_with_no_order_before_cancel_boundary():
    # ready True and no order and createdAt equal to cancelledAt: not after, so ignored
    c = contract()
    a = attempt("2026-06-01T00:00:00Z", ready=True, order=None)
    assert attempt_ran_after_cancel(c, a) is False


def test_attempts_needing_review_filters_a_mixed_list():
    c = contract(attempts=[
        attempt("2026-05-20T00:00:00Z", order={"id": "gid://shopify/Order/1", "name": "#1001", "tags": []}),
        attempt("2026-06-02T00:00:00Z", order={"id": "gid://shopify/Order/2", "name": "#1002", "tags": []}),
    ])
    flagged = list(attempts_needing_review(c))
    assert len(flagged) == 1
    assert flagged[0]["order"]["name"] == "#1002"
