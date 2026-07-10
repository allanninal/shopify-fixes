# Fulfillment stuck On hold

A fulfillment order goes on hold for a real reason (fraud review, a bad address, waiting on stock), the reason gets fixed, but nothing ever calls `fulfillmentOrderReleaseHold`, so the order sits at status `ON_HOLD` forever and never ships. This job pages through `manualHoldsFulfillmentOrders`, keeps only the holds this app itself applied whose reason is one it is allowed to clear on its own, and only on orders a human has tagged as resolved, then releases exactly those hold ids.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/fulfillment-stuck-on-hold/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export HOLD_RESOLVED_TAG="hold-resolved"
export DRY_RUN="true"

python fulfillment-stuck-on-hold/python/release_fulfillment_holds.py
node   fulfillment-stuck-on-hold/node/release-fulfillment-holds.js
```

`holds_to_release` / `holdsToRelease` are pure functions: given a fulfillment order and the confirmation tag, they return only the specific hold ids that are safe to clear, never every hold on the order. High risk of fraud is never auto-released. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest fulfillment-stuck-on-hold/python
node --test fulfillment-stuck-on-hold/node
```
