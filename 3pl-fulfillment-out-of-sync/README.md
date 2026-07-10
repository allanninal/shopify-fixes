# 3PL fulfillment out of sync

A third-party warehouse ships the box and hands the carrier a tracking number, but the update that was supposed to tell Shopify "this is done" never lands, or it lands and silently fails. A `Fulfillment` exists with status `SUCCESS` and a real tracking number, yet the parent `FulfillmentOrder` is still `IN_PROGRESS` or `OPEN`. This job walks recent orders, compares each fulfillment order against the fulfillments attached to it, and tags for review the ones where the warehouse has clearly finished but Shopify has not caught up.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/3pl-fulfillment-out-of-sync/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="14"
export REVIEW_TAG="3pl-out-of-sync"
export DRY_RUN="true"

python 3pl-fulfillment-out-of-sync/python/flag_fulfillment_out_of_sync.py
node   3pl-fulfillment-out-of-sync/node/flag-fulfillment-out-of-sync.js
```

`fulfillment_order_out_of_sync` and `order_needs_review` are pure functions that take plain order data and return a yes or no answer, so the drift check is fully testable without a network call. The only write is a review tag, so the script never forces a fulfillment order closed itself, since that transition belongs to the fulfillment service app that accepted the request. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest 3pl-fulfillment-out-of-sync/python
node --test 3pl-fulfillment-out-of-sync/node
```
