# Webhook subscription auto-deleted

Shopify removes a webhook subscription on its own after delivery keeps failing, for example your endpoint was down for days or kept returning errors. Your app never hears about the removal, it just quietly stops receiving that topic, and the gap stays invisible until someone notices an order or a fulfillment never triggered the expected side effect. This job compares the webhook subscriptions your app requires (topic and endpoint uri) against what Shopify actually has registered with `webhookSubscriptions`, and recreates the ones that are missing with `webhookSubscriptionCreate`. It never touches a subscription that already exists, it only fills gaps.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/webhook-subscription-auto-deleted/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export REQUIRED_WEBHOOKS='[{"topic":"ORDERS_PAID","uri":"https://app.example.com/webhooks/orders-paid"}]'
export DRY_RUN="true"

python webhook-subscription-auto-deleted/python/recreate_missing_webhooks.py
node   webhook-subscription-auto-deleted/node/recreate-missing-webhooks.js
```

`missing_subscriptions` (Python) and `missingSubscriptions` (Node) are pure functions that compare the required topic and uri pairs against what Shopify currently has registered, so the gap check is fully testable without a network call. Start with `DRY_RUN=true` to review the list of subscriptions the job would recreate before it writes anything.

## Test

```bash
pytest webhook-subscription-auto-deleted/python
node --test webhook-subscription-auto-deleted/node
```
