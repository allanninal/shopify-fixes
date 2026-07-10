from flag_fulfillment_out_of_sync import (
    fulfillment_order_out_of_sync,
    has_shipped_tracking,
    order_needs_review,
)


def tracking(number="1Z999", company="UPS"):
    return {"company": company, "number": number, "url": "https://example.com/track"}


def fulfillment(status="SUCCESS", tracking_info=None):
    return {"status": status, "trackingInfo": tracking_info if tracking_info is not None else [tracking()]}


def fulfillment_order(status="IN_PROGRESS", fulfillments=None):
    return {"status": status, "fulfillments": {"nodes": fulfillments if fulfillments is not None else []}}


def order(fulfillment_orders):
    return {"fulfillmentOrders": {"nodes": fulfillment_orders}}


def test_out_of_sync_when_in_progress_but_shipped_with_tracking():
    fo = fulfillment_order(status="IN_PROGRESS", fulfillments=[fulfillment()])
    assert fulfillment_order_out_of_sync(fo) is True


def test_out_of_sync_when_open_but_shipped_with_tracking():
    fo = fulfillment_order(status="OPEN", fulfillments=[fulfillment()])
    assert fulfillment_order_out_of_sync(fo) is True


def test_not_out_of_sync_when_closed():
    fo = fulfillment_order(status="CLOSED", fulfillments=[fulfillment()])
    assert fulfillment_order_out_of_sync(fo) is False


def test_not_out_of_sync_when_no_fulfillments_yet():
    fo = fulfillment_order(status="IN_PROGRESS", fulfillments=[])
    assert fulfillment_order_out_of_sync(fo) is False


def test_not_out_of_sync_when_fulfillment_failed():
    fo = fulfillment_order(status="IN_PROGRESS", fulfillments=[fulfillment(status="FAILURE")])
    assert fulfillment_order_out_of_sync(fo) is False


def test_not_out_of_sync_when_success_but_no_tracking_number():
    empty_tracking = [{"company": "UPS", "number": "", "url": ""}]
    fo = fulfillment_order(status="IN_PROGRESS", fulfillments=[fulfillment(tracking_info=empty_tracking)])
    assert fulfillment_order_out_of_sync(fo) is False


def test_has_shipped_tracking_requires_success_and_number():
    assert has_shipped_tracking(fulfillment()) is True
    assert has_shipped_tracking(fulfillment(status="CANCELLED")) is False
    assert has_shipped_tracking(fulfillment(tracking_info=[])) is False


def test_order_needs_review_true_when_one_fulfillment_order_out_of_sync():
    o = order([
        fulfillment_order(status="CLOSED", fulfillments=[fulfillment()]),
        fulfillment_order(status="IN_PROGRESS", fulfillments=[fulfillment()]),
    ])
    assert order_needs_review(o) is True


def test_order_needs_review_false_when_all_in_sync():
    o = order([fulfillment_order(status="CLOSED", fulfillments=[fulfillment()])])
    assert order_needs_review(o) is False
