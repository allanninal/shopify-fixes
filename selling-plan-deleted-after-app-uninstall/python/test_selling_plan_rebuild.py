from rebuild_selling_plan import (
    needs_selling_plan,
    discount_minor_units,
    selling_plan_group_input,
)


def product(**over):
    base = {
        "id": "gid://shopify/Product/1",
        "title": "Roast Blend",
        "tags": ["subscribe-and-save"],
        "sellingPlanGroupsCount": {"count": 1},
    }
    base.update(over)
    return base


def test_needs_rebuild_when_tagged_and_count_zero():
    assert needs_selling_plan(product(sellingPlanGroupsCount={"count": 0}), "subscribe-and-save") is True


def test_skip_when_group_still_present():
    assert needs_selling_plan(product(), "subscribe-and-save") is False


def test_skip_when_not_tagged():
    assert needs_selling_plan(product(tags=[]), "subscribe-and-save") is False


def test_skip_when_tag_missing_even_with_zero_count():
    assert needs_selling_plan(
        product(tags=["unrelated"], sellingPlanGroupsCount={"count": 0}), "subscribe-and-save"
    ) is False


def test_needs_rebuild_ignores_missing_count_field():
    assert needs_selling_plan(product(sellingPlanGroupsCount={}), "subscribe-and-save") is True


def test_discount_minor_units_rounds_to_nearest_cent():
    assert discount_minor_units(1999, 10) == 1799
    assert discount_minor_units(1000, 15) == 850


def test_discount_minor_units_zero_percent_is_noop():
    assert discount_minor_units(2500, 0) == 2500


def test_selling_plan_group_input_shape():
    payload = selling_plan_group_input("Subscribe and save", 10, "MONTH", 1)
    assert payload["name"] == "Subscribe and save"
    assert payload["merchantCode"] == "subscribe-and-save"
    plan = payload["sellingPlansToCreate"][0]
    assert plan["billingPolicy"]["recurring"]["interval"] == "MONTH"
    assert plan["billingPolicy"]["recurring"]["intervalCount"] == 1
    assert plan["pricingPolicies"][0]["fixed"]["adjustmentValue"]["percentage"] == 10
