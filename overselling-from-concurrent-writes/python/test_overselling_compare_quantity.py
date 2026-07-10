from reconcile_inventory import plan_write, available_quantity


def test_no_write_when_already_correct():
    assert plan_write("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 5) is None


def test_write_carries_compare_quantity_as_current_value():
    write = plan_write("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 4)
    q = write["quantities"][0]
    assert q["compareQuantity"] == 5
    assert q["quantity"] == 4


def test_write_targets_the_right_item_and_location():
    write = plan_write("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 4)
    q = write["quantities"][0]
    assert q["inventoryItemId"] == "gid://shopify/InventoryItem/1"
    assert q["locationId"] == "gid://shopify/Location/1"


def test_write_never_forces_through_compare_failures():
    write = plan_write("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 4)
    assert write["ignoreCompareQuantityFailures"] is False


def test_write_handles_downward_and_upward_corrections():
    down = plan_write("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 4)
    up = plan_write("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 8)
    assert down["quantities"][0]["quantity"] == 4
    assert up["quantities"][0]["quantity"] == 8


def test_available_quantity_reads_named_entry():
    node = {"quantities": [{"name": "committed", "quantity": 2}, {"name": "available", "quantity": 7}]}
    assert available_quantity(node) == 7


def test_available_quantity_missing_returns_none():
    assert available_quantity({"quantities": [{"name": "committed", "quantity": 2}]}) is None


def test_available_quantity_handles_empty_list():
    assert available_quantity({"quantities": []}) is None
