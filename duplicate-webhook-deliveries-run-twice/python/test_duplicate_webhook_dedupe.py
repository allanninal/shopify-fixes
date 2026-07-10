from dedupe_webhook_deliveries import (
    find_duplicate_webhook_id,
    should_flag_for_review,
    already_flagged,
    to_cents,
)

PREFIX = "wh-"
REVIEW_TAG = "duplicate-webhook"


def order(tags):
    return {"tags": tags}


def test_to_cents_rounds():
    assert to_cents("19.99") == 1999
    assert to_cents("50.00") == 5000


def test_no_duplicate_when_each_webhook_id_seen_once():
    tags = ["wh-abc123", "wh-def456"]
    assert find_duplicate_webhook_id(tags, PREFIX) is None


def test_finds_duplicate_webhook_id():
    tags = ["wh-abc123", "wh-def456", "wh-abc123"]
    assert find_duplicate_webhook_id(tags, PREFIX) == "abc123"


def test_ignores_tags_without_prefix():
    tags = ["vip", "wh-abc123", "wh-abc123"]
    assert find_duplicate_webhook_id(tags, PREFIX) == "abc123"


def test_no_duplicate_with_no_webhook_tags():
    assert find_duplicate_webhook_id([], PREFIX) is None
    assert find_duplicate_webhook_id(None, PREFIX) is None


def test_already_flagged_true_when_review_tag_present():
    assert already_flagged(["duplicate-webhook"], REVIEW_TAG) is True


def test_already_flagged_false_when_absent():
    assert already_flagged(["vip"], REVIEW_TAG) is False


def test_should_flag_when_duplicate_and_not_yet_flagged():
    o = order(["wh-abc123", "wh-abc123"])
    assert should_flag_for_review(o, PREFIX, REVIEW_TAG) is True


def test_should_not_flag_when_no_duplicate():
    o = order(["wh-abc123", "wh-def456"])
    assert should_flag_for_review(o, PREFIX, REVIEW_TAG) is False


def test_should_not_flag_when_already_flagged():
    o = order(["wh-abc123", "wh-abc123", "duplicate-webhook"])
    assert should_flag_for_review(o, PREFIX, REVIEW_TAG) is False
