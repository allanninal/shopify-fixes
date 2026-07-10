# Duplicate renewal charges

A subscription renewal retried after a timeout or a redelivered webhook, and Shopify had no idempotency key to tell the second attempt was the same charge as the first, so it billed the customer twice for one cycle. This job walks each subscription contract's recent billing attempts, groups them by billing cycle, and tags every order after the first successful charge in a cycle for a refund review with `tagsAdd`.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/duplicate-renewal-charges/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export REVIEW_TAG="duplicate-renewal"
export DRY_RUN="true"

python duplicate-renewal-charges/python/find_duplicate_renewals.py
node   duplicate-renewal-charges/node/find-duplicate-renewals.js
```

`find_duplicate_orders` is a pure function that works in minor units and takes a contract's billing attempts oldest first, so grouping by cycle never depends on floating-point money or on the order Shopify happens to return results in. The only write is a review tag, so it never refunds or cancels anything on its own. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest duplicate-renewal-charges/python
node --test duplicate-renewal-charges/node
```
