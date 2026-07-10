from find_duplicate_customers import (
    normalize_email,
    group_by_email,
    choose_survivor,
    plan_merge,
    merge_preview_is_clean,
    to_cents,
)


def customer(id, email, orders=0, created="2024-01-01T00:00:00Z", tags=None):
    return {
        "id": id,
        "email": email,
        "numberOfOrders": orders,
        "createdAt": created,
        "tags": tags or [],
    }


def test_normalize_email_folds_case_and_trims():
    assert normalize_email(" Buyer@Example.com ") == "buyer@example.com"
    assert normalize_email(None) == ""


def test_to_cents_rounds():
    assert to_cents("50.00") == 5000
    assert to_cents("9.99") == 999


def test_group_by_email_only_returns_duplicates():
    customers = [
        customer("gid://1", "a@example.com"),
        customer("gid://2", "a@example.com"),
        customer("gid://3", "b@example.com"),
    ]
    groups = group_by_email(customers)
    assert list(groups.keys()) == ["a@example.com"]
    assert len(groups["a@example.com"]) == 2


def test_group_by_email_is_case_insensitive():
    customers = [
        customer("gid://1", "Buyer@Example.com"),
        customer("gid://2", "buyer@example.com"),
    ]
    groups = group_by_email(customers)
    assert len(groups["buyer@example.com"]) == 2


def test_choose_survivor_prefers_more_orders():
    a = customer("gid://1", "x@example.com", orders=1, created="2024-05-01T00:00:00Z")
    b = customer("gid://2", "x@example.com", orders=5, created="2024-06-01T00:00:00Z")
    assert choose_survivor([a, b]) is b


def test_choose_survivor_breaks_tie_with_older_record():
    a = customer("gid://1", "x@example.com", orders=2, created="2024-06-01T00:00:00Z")
    b = customer("gid://2", "x@example.com", orders=2, created="2023-01-01T00:00:00Z")
    assert choose_survivor([a, b]) is b


def test_plan_merge_merges_clean_pair():
    a = customer("gid://1", "x@example.com", orders=1)
    b = customer("gid://2", "x@example.com", orders=5)
    decision = plan_merge([a, b])
    assert decision["action"] == "merge"
    assert decision["survivor"] is b
    assert decision["loser"] is a


def test_plan_merge_skips_groups_of_three():
    a = customer("gid://1", "x@example.com")
    b = customer("gid://2", "x@example.com")
    c = customer("gid://3", "x@example.com")
    decision = plan_merge([a, b, c])
    assert decision["action"] == "skip"


def test_plan_merge_skips_protected_customer():
    a = customer("gid://1", "x@example.com", tags=["do-not-merge"])
    b = customer("gid://2", "x@example.com")
    decision = plan_merge([a, b])
    assert decision["action"] == "skip"


def test_merge_preview_is_clean_true_when_no_conflicts():
    assert merge_preview_is_clean({"conflictingFields": []}) is True
    assert merge_preview_is_clean({}) is True


def test_merge_preview_is_clean_false_when_conflicts_present():
    preview = {"conflictingFields": [{"description": "Default address"}]}
    assert merge_preview_is_clean(preview) is False
