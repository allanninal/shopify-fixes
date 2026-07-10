from retry_failed_billing import failed_attempt_count, retry_decision


def attempt(created_at, completed_at=None):
    return {"id": "gid://shopify/SubscriptionBillingAttempt/1", "createdAt": created_at, "completedAt": completed_at}


def contract(**over):
    base = {
        "id": "gid://shopify/SubscriptionContract/1",
        "lastPaymentStatus": "FAILED",
        "billingAttempts": [attempt("2026-07-05T00:00:00+00:00")],
    }
    base.update(over)
    return base


def test_failed_attempt_count_stops_at_first_completed():
    attempts = [
        attempt("2026-07-05T00:00:00+00:00"),
        attempt("2026-07-02T00:00:00+00:00"),
        attempt("2026-06-20T00:00:00+00:00", completed_at="2026-06-20T00:05:00+00:00"),
    ]
    assert failed_attempt_count(attempts) == 2


def test_failed_attempt_count_zero_when_most_recent_succeeded():
    attempts = [attempt("2026-07-05T00:00:00+00:00", completed_at="2026-07-05T00:05:00+00:00")]
    assert failed_attempt_count(attempts) == 0


def test_no_retry_when_last_payment_not_failed():
    assert retry_decision(contract(lastPaymentStatus="SUCCEEDED"), "2026-07-10T00:00:00+00:00") is False


def test_no_retry_before_the_backoff_window():
    # 1st failure, needs 1 day, only a few hours have passed
    c = contract(billingAttempts=[attempt("2026-07-09T20:00:00+00:00")])
    assert retry_decision(c, "2026-07-10T00:00:00+00:00") is False


def test_retry_once_first_backoff_window_elapses():
    # 1st failure, needs 1 day, exactly 1 day has passed
    c = contract(billingAttempts=[attempt("2026-07-09T00:00:00+00:00")])
    assert retry_decision(c, "2026-07-10T00:00:00+00:00") is True


def test_retry_uses_longer_window_for_later_attempts():
    attempts = [
        attempt("2026-07-08T00:00:00+00:00"),  # most recent, 2nd failure
        attempt("2026-07-05T00:00:00+00:00"),  # 1st failure
    ]
    # 2nd failure needs 3 days; only 2 have passed since the most recent attempt
    c = contract(billingAttempts=attempts)
    assert retry_decision(c, "2026-07-10T00:00:00+00:00") is False


def test_retry_when_third_backoff_window_elapses():
    attempts = [
        attempt("2026-07-03T00:00:00+00:00"),  # most recent, 3rd failure
        attempt("2026-06-30T00:00:00+00:00"),
        attempt("2026-06-27T00:00:00+00:00"),
    ]
    # 3rd failure needs 7 days; exactly 7 have passed
    c = contract(billingAttempts=attempts)
    assert retry_decision(c, "2026-07-10T00:00:00+00:00") is True


def test_no_retry_after_max_retries_exhausted():
    attempts = [
        attempt("2026-07-01T00:00:00+00:00"),
        attempt("2026-06-28T00:00:00+00:00"),
        attempt("2026-06-25T00:00:00+00:00"),
        attempt("2026-06-20T00:00:00+00:00"),
    ]
    c = contract(billingAttempts=attempts)
    assert retry_decision(c, "2026-07-20T00:00:00+00:00") is False


def test_no_retry_with_no_billing_history():
    c = contract(billingAttempts=[])
    assert retry_decision(c, "2026-07-10T00:00:00+00:00") is False
