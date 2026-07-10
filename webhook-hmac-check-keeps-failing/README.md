# Webhook HMAC check keeps failing

Shopify signs every webhook with an HMAC-SHA256 of the exact bytes it sent, in the `X-Shopify-Hmac-Sha256` header. If your handler parses the JSON body first, logs it, or hands it to a framework that re-serializes it before your verification code runs, the bytes you check against no longer match the bytes Shopify signed, and every single webhook fails verification even though nothing is actually wrong. This folder holds the pure `verifyHmac` / `verify_hmac` function (no I/O, fully unit tested) that checks a raw body against the header, plus a small audit job that pages through `webhookSubscriptions` on the Admin GraphQL API and flags any subscription still delivering as XML, since that is the other common cause of a signature that never matches, and repairs it with `webhookSubscriptionUpdate`.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/webhook-hmac-check-keeps-failing/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export SHOPIFY_CLIENT_SECRET="shpss_..."
export DRY_RUN="true"

python webhook-hmac-check-keeps-failing/python/verify_webhook_hmac.py
node   webhook-hmac-check-keeps-failing/node/verify-webhook-hmac.js
```

`verify_hmac` / `verifyHmac` and `misconfigured_subscriptions` / `misconfiguredSubscriptions` are pure functions, so the tests need no network and no Shopify account. Start with `DRY_RUN=true` to see which webhook subscriptions the audit would switch to JSON before it writes anything.

## Test

```bash
pytest webhook-hmac-check-keeps-failing/python
node --test webhook-hmac-check-keeps-failing/node/webhook-hmac.test.js
```
