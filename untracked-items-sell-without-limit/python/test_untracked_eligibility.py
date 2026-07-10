from fix_untracked_items import eligible_to_track


def variant(**over):
    base = {
        "inventoryItem": {"id": "gid://shopify/InventoryItem/1", "tracked": False},
        "product": {"tags": ["track-me"]},
    }
    base.update(over)
    return base


def test_eligible_when_untracked_sold_and_tagged():
    assert eligible_to_track(variant(), 3, "track-me") is True


def test_skip_when_already_tracked():
    v = variant(inventoryItem={"id": "gid://shopify/InventoryItem/1", "tracked": True})
    assert eligible_to_track(v, 3, "track-me") is False


def test_skip_when_no_recent_sales():
    assert eligible_to_track(variant(), 0, "track-me") is False


def test_skip_without_tag():
    v = variant(product={"tags": []})
    assert eligible_to_track(v, 3, "track-me") is False


def test_respects_custom_minimum_sales():
    assert eligible_to_track(variant(), 2, "track-me", min_sales=5) is False
    assert eligible_to_track(variant(), 5, "track-me", min_sales=5) is True


def test_missing_inventory_item_defaults_to_untracked():
    v = variant(inventoryItem={})
    assert eligible_to_track(v, 3, "track-me") is True


def test_missing_product_tags_defaults_to_no_tags():
    v = variant(product={})
    assert eligible_to_track(v, 3, "track-me") is False
