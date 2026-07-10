# Duplicate webhook deliveries run twice

Shopify retries a webhook when your endpoint is slow or answers with a non-2xx status, and the same delivery can also arrive twice over the network. Every delivery carries a unique `X-Shopify-Webhook-Id` header. If a handler does not check that id before acting, a retried delivery runs the handler again and doubles whatever it does, such as granting store credit twice or sending two confirmation emails. This job reconciles after the fact: it reads the ledger of processed webhook ids each handler stamps onto the order as `wh-<webhook id>` tags, finds orders where the same id shows up more than once, and tags those orders for review with `tagsAdd`.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/duplicate-webhook-deliveries-run-twice/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="7"
export REVIEW_TAG="duplicate-webhook"
export WEBHOOK_TAG_PREFIX="wh-"
export DRY_RUN="true"

python duplicate-webhook-deliveries-run-twice/python/dedupe_webhook_deliveries.py
node   duplicate-webhook-deliveries-run-twice/node/dedupe-webhook-deliveries.js
```

`find_duplicate_webhook_id` and `should_flag_for_review` are pure functions with no I/O, so the decision logic is fully testable without a store or a live webhook. The only write is a review tag, so it never touches money or inventory on its own. Start with `DRY_RUN=true` to see the exact list before it writes anything.

## Test

```bash
pytest duplicate-webhook-deliveries-run-twice/python
node --test duplicate-webhook-deliveries-run-twice/node
```
