# Reconcile orders against payouts

A bank deposit is one number. The orders behind it are many. This job pages through recent Shopify Payments payouts, sums the `net` amount of every balance transaction associated with each payout, and compares that sum to the payout's own `net` amount. When the two do not tie out to the cent, either a balance transaction is missing, a currency got mixed in, or Shopify's own numbers disagree, and the payout gets tagged for review with `tagsAdd` instead of silently trusted.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/reconcile-orders-against-payouts/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export PAYOUT_LOOKBACK="10"
export REVIEW_TAG="payout-mismatch"
export TOLERANCE_CENTS="1"
export DRY_RUN="true"

python reconcile-orders-against-payouts/python/reconcile_payout_orders.py
node   reconcile-orders-against-payouts/node/reconcile-payout-orders.js
```

`net_transactions_cents` and `payout_mismatch_cents` (`netTransactionsCents` and `payoutMismatchCents` in Node) are pure functions that work in minor units, so the comparison never suffers floating-point drift and is fully testable without a store. The only write is a review tag on the payout, so it never moves money. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest reconcile-orders-against-payouts/python
node --test reconcile-orders-against-payouts/node
```
