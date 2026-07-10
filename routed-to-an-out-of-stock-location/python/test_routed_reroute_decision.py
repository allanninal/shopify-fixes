from reroute_out_of_stock_fulfillment import pick_reroute_location, total_remaining


def line_item(remaining=1, item_id="gid://shopify/FulfillmentOrderLineItem/1"):
    return {"id": item_id, "remainingQuantity": remaining}


def candidate(location_id, covered_items, name="Warehouse B"):
    return {
        "location": {"id": location_id, "name": name},
        "message": None,
        "availableLineItems": {"nodes": covered_items},
    }


def fulfillment_order(status="OPEN", line_items=None, candidates=None):
    return {
        "id": "gid://shopify/FulfillmentOrder/1",
        "status": status,
        "lineItems": {"nodes": line_items if line_items is not None else [line_item(2)]},
        "locationsForMove": {"nodes": candidates or []},
    }


def test_total_remaining_sums_quantities():
    assert total_remaining([line_item(2), line_item(3)]) == 5
    assert total_remaining([]) == 0
    assert total_remaining(None) == 0


def test_skips_orders_that_are_not_movable():
    order = fulfillment_order(status="CLOSED", candidates=[candidate("gid://shopify/Location/2", [line_item(2)])])
    assert pick_reroute_location(order) is None


def test_skips_orders_with_nothing_left_to_fulfill():
    order = fulfillment_order(line_items=[line_item(0)], candidates=[candidate("gid://shopify/Location/2", [line_item(0)])])
    assert pick_reroute_location(order) is None


def test_skips_when_no_candidate_covers_all_remaining_quantity():
    order = fulfillment_order(line_items=[line_item(5)], candidates=[candidate("gid://shopify/Location/2", [line_item(3)])])
    assert pick_reroute_location(order) is None


def test_picks_the_only_location_that_can_cover_everything():
    order = fulfillment_order(
        line_items=[line_item(2)],
        candidates=[candidate("gid://shopify/Location/2", [line_item(2)])],
    )
    assert pick_reroute_location(order) == "gid://shopify/Location/2"


def test_picks_the_candidate_with_the_most_coverage_when_several_qualify():
    order = fulfillment_order(
        line_items=[line_item(2)],
        candidates=[
            candidate("gid://shopify/Location/2", [line_item(2)]),
            candidate("gid://shopify/Location/3", [line_item(9)]),
        ],
    )
    assert pick_reroute_location(order) == "gid://shopify/Location/3"


def test_ignores_a_candidate_with_no_message_field_present():
    order = fulfillment_order(
        line_items=[line_item(1)],
        candidates=[{"location": {"id": "gid://shopify/Location/4", "name": "Pop-up"}, "availableLineItems": {"nodes": [line_item(1)]}}],
    )
    assert pick_reroute_location(order) == "gid://shopify/Location/4"
