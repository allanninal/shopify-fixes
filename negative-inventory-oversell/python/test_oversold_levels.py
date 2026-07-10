from fix_negative_inventory import oversold_levels, available_of


def level(location_id, available):
    return {
        "location": {"id": location_id, "name": location_id},
        "quantities": [{"name": "available", "quantity": available}],
    }


def variant(*levels):
    return {"id": "gid://shopify/ProductVariant/1", "sku": "SKU1",
            "inventoryItem": {"id": "gid://shopify/InventoryItem/9",
                              "inventoryLevels": {"nodes": list(levels)}}}


def test_available_of_reads_the_named_quantity():
    assert available_of(level("loc/1", -3)) == -3


def test_available_of_none_when_absent():
    assert available_of({"quantities": [{"name": "on_hand", "quantity": 5}]}) is None


def test_no_oversold_when_all_non_negative():
    assert oversold_levels(variant(level("loc/1", 0), level("loc/2", 5))) == []


def test_finds_single_oversold_location():
    out = oversold_levels(variant(level("loc/1", -2), level("loc/2", 4)))
    assert len(out) == 1 and out[0]["locationId"] == "loc/1" and out[0]["available"] == -2


def test_finds_multiple_oversold_locations():
    out = oversold_levels(variant(level("loc/1", -2), level("loc/2", -7)))
    assert sorted(l["available"] for l in out) == [-7, -2]


def test_carries_inventory_item_id():
    out = oversold_levels(variant(level("loc/1", -1)))
    assert out[0]["inventoryItemId"] == "gid://shopify/InventoryItem/9"
