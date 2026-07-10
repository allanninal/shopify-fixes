from find_available_vs_committed_drift import (
    quantities_by_name,
    drift_for_level,
    levels_with_drift,
)


def level(**over):
    quantities = [
        {"name": "available", "quantity": 10},
        {"name": "on_hand", "quantity": 10},
        {"name": "committed", "quantity": 0},
        {"name": "damaged", "quantity": 0},
        {"name": "safety_stock", "quantity": 0},
    ]
    for name, value in over.items():
        for q in quantities:
            if q["name"] == name:
                q["quantity"] = value
    return {"location": {"id": "gid://shopify/Location/1", "name": "Warehouse"}, "quantities": quantities}


def test_quantities_by_name_fills_missing_with_zero():
    lvl = {"quantities": [{"name": "available", "quantity": 5}]}
    q = quantities_by_name(lvl)
    assert q["available"] == 5
    assert q["committed"] == 0
    assert q["damaged"] == 0


def test_no_drift_when_available_matches_on_hand_minus_committed():
    # on_hand 10, committed 4 -> expected available 6
    assert drift_for_level(level(on_hand=10, committed=4, available=6)) == 0


def test_drift_when_available_was_never_reduced_by_committed():
    # on_hand still 10, committed 4, but available was left at 10 (the bug)
    assert drift_for_level(level(on_hand=10, committed=4, available=10)) == 4


def test_drift_accounts_for_damaged_and_safety_stock():
    # 20 on hand, 5 committed, 2 damaged, 3 safety stock -> expected available 10
    assert drift_for_level(level(on_hand=20, committed=5, damaged=2, safety_stock=3, available=10)) == 0
    assert drift_for_level(level(on_hand=20, committed=5, damaged=2, safety_stock=3, available=15)) == 5


def test_negative_drift_when_available_overcorrected():
    # available lower than the buckets imply is also a drift, just negative
    assert drift_for_level(level(on_hand=10, committed=0, available=8)) == -2


def test_levels_with_drift_only_returns_offending_locations():
    item = {
        "inventoryLevels": {
            "nodes": [
                level(on_hand=10, committed=4, available=6),   # ties out
                level(on_hand=10, committed=4, available=10),  # drift of 4
            ]
        }
    }
    result = levels_with_drift(item)
    assert len(result) == 1
    assert result[0]["drift"] == 4
    assert result[0]["locationName"] == "Warehouse"


def test_levels_with_drift_empty_when_everything_ties_out():
    item = {"inventoryLevels": {"nodes": [level(), level(on_hand=5, committed=2, available=3)]}}
    assert levels_with_drift(item) == []
