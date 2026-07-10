# Paid checkouts stranded as abandoned

A checkout can finish payment while the order write never lands, for example a webhook that timed out, an app that crashed mid write, or a duplicate submit that raced itself. Shopify's own abandoned checkout report still calls this "abandoned" because no order followed, so a real, paid checkout hides in a list meant for carts nobody finished. This job lists recently completed checkouts from `abandonedCheckouts`, checks whether a matching order exists with a `checkout_token` search, and tags the ones that are paid with nothing behind them for a human to reconcile.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/paid-checkouts-stranded-as-abandoned/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="3"
export MIN_STRANDED_CENTS="1"
export RECONCILE_TAG="stranded-checkout"
export DRY_RUN="true"

python paid-checkouts-stranded-as-abandoned/python/find_stranded_checkouts.py
node   paid-checkouts-stranded-as-abandoned/node/find-stranded-checkouts.js
```

`is_stranded` (Python) and `isStranded` (Node) are pure functions that work in minor units, so the comparison never suffers floating point drift and is fully testable without a store. The only write is a reconciliation tag, so it never creates an order or moves money on its own. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest paid-checkouts-stranded-as-abandoned/python
node --test paid-checkouts-stranded-as-abandoned/node
```
