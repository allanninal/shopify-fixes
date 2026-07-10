from repair_external_id_metafield import needs_repair, plan_repairs


def order(name="#1001", value=None):
    return {
        "id": f"gid://shopify/Order/{name.strip('#')}",
        "name": name,
        "metafield": {"id": "gid://shopify/Metafield/1", "value": value} if value is not None else None,
    }


def test_needs_repair_when_metafield_missing():
    assert needs_repair(order(value=None), "ext-9001") is True


def test_needs_repair_when_value_does_not_match():
    assert needs_repair(order(value="ext-old"), "ext-9001") is True


def test_no_repair_when_value_already_matches():
    assert needs_repair(order(value="ext-9001"), "ext-9001") is False


def test_no_repair_when_no_expected_id_known():
    # We have no source-of-truth id for this order yet, so leave it alone.
    assert needs_repair(order(value=None), None) is False


def test_plan_repairs_only_includes_mismatches():
    orders = [
        order(name="#1001", value=None),
        order(name="#1002", value="ext-2002"),
        order(name="#1003", value="ext-stale"),
    ]
    lookup = {"#1001": "ext-1001", "#1002": "ext-2002", "#1003": "ext-3003"}
    plan = plan_repairs(orders, lookup)
    names = sorted(o["name"] for o, _ in plan)
    assert names == ["#1001", "#1003"]


def test_plan_repairs_skips_orders_with_no_lookup_entry():
    orders = [order(name="#1004", value=None)]
    plan = plan_repairs(orders, {})
    assert plan == []
