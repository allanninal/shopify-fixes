import base64
import hashlib
import hmac as hmac_lib

from verify_webhook_hmac import compute_hmac, verify_hmac, misconfigured_subscriptions

SECRET = "shpss_test_secret"


def sign(raw_body, secret=SECRET):
    digest = hmac_lib.new(secret.encode("utf-8"), raw_body.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def test_compute_hmac_matches_manual_signature():
    raw_body = '{"id":1,"note":null}'
    assert compute_hmac(raw_body, SECRET) == sign(raw_body)


def test_verify_true_for_correct_raw_body():
    raw_body = '{"id":1,"note":null}'
    header = sign(raw_body)
    assert verify_hmac(raw_body, header, SECRET) is True


def test_verify_false_when_body_was_reserialized():
    # Simulates the real bug: the handler parsed the JSON, then re-dumped it
    # with different key order and spacing before checking the signature.
    raw_body = '{"id":1,"note":null}'
    header = sign(raw_body)
    reserialized_body = '{"note": null, "id": 1}'
    assert verify_hmac(reserialized_body, header, SECRET) is False


def test_verify_false_with_wrong_secret():
    raw_body = '{"id":1}'
    header = sign(raw_body, secret="wrong_secret")
    assert verify_hmac(raw_body, header, SECRET) is False


def test_verify_false_with_missing_header():
    assert verify_hmac('{"id":1}', "", SECRET) is False
    assert verify_hmac('{"id":1}', None, SECRET) is False


def test_verify_works_with_bytes_body():
    raw_body = b'{"id":1,"amount":"9.99"}'
    header = sign(raw_body.decode("utf-8"))
    assert verify_hmac(raw_body, header, SECRET) is True


def test_misconfigured_subscriptions_flags_non_json():
    subs = [
        {"id": "gid://shopify/WebhookSubscription/1", "topic": "ORDERS_PAID", "uri": "https://a", "format": "JSON"},
        {"id": "gid://shopify/WebhookSubscription/2", "topic": "ORDERS_UPDATED", "uri": "https://b", "format": "XML"},
    ]
    result = misconfigured_subscriptions(subs)
    assert len(result) == 1
    assert result[0]["topic"] == "ORDERS_UPDATED"


def test_misconfigured_subscriptions_empty_when_all_json():
    subs = [{"id": "1", "topic": "ORDERS_PAID", "uri": "https://a", "format": "JSON"}]
    assert misconfigured_subscriptions(subs) == []
