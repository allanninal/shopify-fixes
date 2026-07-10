import pytest
from reconcile_available import plan_reconciliation


def test_no_plan_when_within_tolerance():
    assert plan_reconciliation(40, 39, tolerance=1) is None


def test_plan_when_real_is_higher():
    plan = plan_reconciliation(40, 31, tolerance=1)
    assert plan == {"quantity": 40, "compare_quantity": 31, "drift": 9}


def test_plan_when_real_is_lower():
    plan = plan_reconciliation(20, 25, tolerance=1)
    assert plan == {"quantity": 20, "compare_quantity": 25, "drift": -5}


def test_exact_tolerance_boundary_is_not_a_drift():
    assert plan_reconciliation(10, 8, tolerance=2) is None


def test_one_past_tolerance_is_a_drift():
    plan = plan_reconciliation(11, 8, tolerance=2)
    assert plan == {"quantity": 11, "compare_quantity": 8, "drift": 3}


def test_zero_tolerance_flags_any_gap():
    plan = plan_reconciliation(5, 4, tolerance=0)
    assert plan == {"quantity": 5, "compare_quantity": 4, "drift": 1}


def test_rejects_negative_real_count():
    with pytest.raises(ValueError):
        plan_reconciliation(-1, 5, tolerance=1)


def test_rejects_negative_shopify_available():
    with pytest.raises(ValueError):
        plan_reconciliation(5, -1, tolerance=1)


def test_rejects_negative_tolerance():
    with pytest.raises(ValueError):
        plan_reconciliation(5, 5, tolerance=-1)
