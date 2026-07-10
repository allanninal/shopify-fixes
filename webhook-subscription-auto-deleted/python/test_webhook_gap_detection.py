from recreate_missing_webhooks import missing_subscriptions


def existing(topic, uri):
    return {"topic": topic, "uri": uri, "id": "gid://shopify/WebhookSubscription/1", "format": "JSON"}


def required(topic, uri):
    return {"topic": topic, "uri": uri}


def test_no_gap_when_everything_registered():
    current = [existing("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")]
    need = [required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")]
    assert missing_subscriptions(current, need) == []


def test_gap_when_topic_missing_entirely():
    current = []
    need = [required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")]
    assert missing_subscriptions(current, need) == need


def test_gap_when_uri_does_not_match():
    current = [existing("ORDERS_PAID", "https://old.example.com/hooks/orders-paid")]
    need = [required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")]
    assert missing_subscriptions(current, need) == need


def test_only_missing_ones_are_returned():
    current = [existing("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")]
    need = [
        required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid"),
        required("FULFILLMENTS_CREATE", "https://app.example.com/hooks/fulfillments-create"),
    ]
    assert missing_subscriptions(current, need) == [need[1]]


def test_topic_comparison_is_case_insensitive():
    current = [existing("orders_paid", "https://app.example.com/hooks/orders-paid")]
    need = [required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")]
    assert missing_subscriptions(current, need) == []


def test_empty_required_returns_empty():
    current = [existing("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")]
    assert missing_subscriptions(current, []) == []
