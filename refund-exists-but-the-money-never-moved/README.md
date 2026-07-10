# Refund exists but the money never moved

A refund record can sit on a Shopify order while the gateway transaction underneath it failed, errored, or never left PENDING. Support and the order timeline both say "Refunded," but the customer's card or bank never actually received anything. This job sums each refund's `SUCCESS`-only transactions in minor units, compares that to the refund's own `totalRefundedSet`, and tags the order for review with `tagsAdd` when the two do not match.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/refund-exists-but-the-money-never-moved/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="14"
export REVIEW_TAG="refund-stuck"
export DRY_RUN="true"

python refund-exists-but-the-money-never-moved/python/find_stuck_refunds.py
node   refund-exists-but-the-money-never-moved/node/find-stuck-refunds.js
```

`moved_cents` and `is_stuck_refund` are pure functions that work in minor units, so the comparison never suffers floating-point drift and is fully testable. The only write is a review tag, so it never retries a payment or moves money. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest refund-exists-but-the-money-never-moved/python
node --test refund-exists-but-the-money-never-moved/node
```
