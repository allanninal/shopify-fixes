from find_untaxed_partial_refunds import (
    line_item_tax_rate,
    expected_tax_cents_for_refund,
    actual_tax_refunded_cents,
    untaxed_refund_gap_cents,
    to_cents,
)


def line_item(id="gid://shopify/LineItem/1", unit_price="50.00", quantity=1, tax="4.00"):
    return {
        "id": id,
        "quantity": quantity,
        "originalUnitPriceSet": {"shopMoney": {"amount": unit_price}},
        "taxLines": [{"priceSet": {"shopMoney": {"amount": tax}}}] if tax is not None else [],
    }


def refund_line(line_item_id="gid://shopify/LineItem/1", subtotal="50.00", tax="0.00"):
    return {
        "quantity": 1,
        "lineItem": {"id": line_item_id},
        "subtotalSet": {"shopMoney": {"amount": subtotal}},
        "totalTaxSet": {"shopMoney": {"amount": tax}},
    }


def refund(lines):
    return {"refundLineItems": {"nodes": lines}}


def test_line_item_tax_rate_computes_fraction_of_unit_price():
    # $4 tax on a $50 unit is an 8% rate.
    assert round(line_item_tax_rate(line_item(unit_price="50.00", tax="4.00")), 4) == 0.08


def test_line_item_tax_rate_zero_when_no_tax_lines():
    assert line_item_tax_rate(line_item(tax=None)) == 0.0


def test_line_item_tax_rate_zero_when_unit_price_is_zero():
    assert line_item_tax_rate(line_item(unit_price="0.00")) == 0.0


def test_line_item_tax_rate_divides_by_full_quantity_price():
    # $8 tax on 2 units at $50 each ($100 total) is still an 8% rate.
    assert round(line_item_tax_rate(line_item(unit_price="50.00", quantity=2, tax="8.00")), 4) == 0.08


def test_expected_tax_matches_original_rate():
    items = {"gid://shopify/LineItem/1": line_item(unit_price="50.00", tax="4.00")}
    r = refund([refund_line(subtotal="50.00", tax="0.00")])
    # the refund gave back the full $50 item, so it should have refunded $4 of tax too
    assert expected_tax_cents_for_refund(r, items) == 400


def test_actual_tax_refunded_sums_refund_lines():
    r = refund([refund_line(tax="1.50"), refund_line(tax="2.50")])
    assert actual_tax_refunded_cents(r) == 400


def test_gap_detects_tax_left_untouched():
    items = {"gid://shopify/LineItem/1": line_item(unit_price="50.00", tax="4.00")}
    r = refund([refund_line(subtotal="50.00", tax="0.00")])
    assert untaxed_refund_gap_cents(r, items) == 400


def test_gap_is_zero_when_refund_already_tied_out():
    items = {"gid://shopify/LineItem/1": line_item(unit_price="50.00", tax="4.00")}
    r = refund([refund_line(subtotal="50.00", tax="4.00")])
    assert untaxed_refund_gap_cents(r, items) == 0


def test_gap_ignores_rounding_noise_under_the_threshold():
    items = {"gid://shopify/LineItem/1": line_item(unit_price="50.00", tax="4.00")}
    # refund includes 3.99 of tax instead of 4.00, a single cent of drift
    r = refund([refund_line(subtotal="50.00", tax="3.99")])
    assert untaxed_refund_gap_cents(r, items, min_gap_cents=2) == 0


def test_gap_is_zero_when_refund_has_no_line_items():
    assert untaxed_refund_gap_cents(refund([]), {}) == 0


def test_gap_never_goes_negative_when_tax_over_refunded():
    items = {"gid://shopify/LineItem/1": line_item(unit_price="50.00", tax="4.00")}
    r = refund([refund_line(subtotal="50.00", tax="9.00")])
    assert untaxed_refund_gap_cents(r, items) == 0


def test_gap_ignores_line_items_missing_from_the_order():
    r = refund([refund_line(line_item_id="gid://shopify/LineItem/999", subtotal="50.00", tax="0.00")])
    assert untaxed_refund_gap_cents(r, {}) == 0


def test_to_cents_rounds():
    assert to_cents("9.99") == 999
    assert to_cents("4.00") == 400
