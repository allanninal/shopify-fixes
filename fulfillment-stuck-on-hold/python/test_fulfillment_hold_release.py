from release_fulfillment_holds import holds_to_release, RELEASABLE_REASONS


def hold(**over):
    base = {
        "id": "gid://shopify/FulfillmentHold/1",
        "reason": "INVENTORY_OUT_OF_STOCK",
        "reasonNotes": "Waiting on new shipment",
        "heldByRequestingApp": True,
    }
    base.update(over)
    return base


def fulfillment_order(**over):
    base = {
        "id": "gid://shopify/FulfillmentOrder/1",
        "status": "ON_HOLD",
        "order": {"id": "gid://shopify/Order/1", "name": "#1001", "tags": ["hold-resolved"]},
        "fulfillmentHolds": [hold()],
    }
    base.update(over)
    return base


def test_releases_when_on_hold_tagged_and_reason_is_releasable():
    fo = fulfillment_order()
    assert holds_to_release(fo, "hold-resolved") == ["gid://shopify/FulfillmentHold/1"]


def test_skips_when_not_on_hold():
    fo = fulfillment_order(status="OPEN")
    assert holds_to_release(fo, "hold-resolved") == []


def test_skips_when_order_missing_confirmation_tag():
    fo = fulfillment_order(order={"id": "gid://shopify/Order/1", "name": "#1001", "tags": []})
    assert holds_to_release(fo, "hold-resolved") == []


def test_skips_holds_not_applied_by_this_app():
    fo = fulfillment_order(fulfillmentHolds=[hold(heldByRequestingApp=False)])
    assert holds_to_release(fo, "hold-resolved") == []


def test_skips_high_risk_of_fraud_even_if_tagged():
    fo = fulfillment_order(fulfillmentHolds=[hold(reason="HIGH_RISK_OF_FRAUD")])
    assert holds_to_release(fo, "hold-resolved") == []
    assert "HIGH_RISK_OF_FRAUD" not in RELEASABLE_REASONS


def test_only_releases_the_matching_holds_on_a_multi_hold_order():
    fo = fulfillment_order(fulfillmentHolds=[
        hold(id="gid://shopify/FulfillmentHold/1", reason="INVENTORY_OUT_OF_STOCK"),
        hold(id="gid://shopify/FulfillmentHold/2", reason="HIGH_RISK_OF_FRAUD"),
        hold(id="gid://shopify/FulfillmentHold/3", heldByRequestingApp=False),
        hold(id="gid://shopify/FulfillmentHold/4", reason="INCORRECT_ADDRESS"),
    ])
    assert holds_to_release(fo, "hold-resolved") == [
        "gid://shopify/FulfillmentHold/1",
        "gid://shopify/FulfillmentHold/4",
    ]


def test_no_holds_means_nothing_to_release():
    fo = fulfillment_order(fulfillmentHolds=[])
    assert holds_to_release(fo, "hold-resolved") == []
