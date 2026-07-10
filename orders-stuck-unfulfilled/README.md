# Orders stuck Unfulfilled

A paid order that sits unfulfilled for days is a late shipment waiting to happen, but nothing in Shopify surfaces it on its own. This job lists paid, unfulfilled, not-cancelled orders, keeps the ones older than your shipping SLA that are not on hold, and tags them for review with `tagsAdd` so the team catches them before the customer complains.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/orders-stuck-unfulfilled/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export SLA_DAYS="3"
export REVIEW_TAG="fulfillment-overdue"
export DRY_RUN="true"

python orders-stuck-unfulfilled/python/flag_stale_unfulfilled.py
node   orders-stuck-unfulfilled/node/flag-stale-unfulfilled.js
```

`is_stale_unfulfilled` is a pure function (the current time is passed in): an order is flagged only when it is unfulfilled, older than the SLA, not on hold, and not already tagged. The only write is a review tag, so it never fulfills or edits an order. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest orders-stuck-unfulfilled/python
node --test orders-stuck-unfulfilled/node
```
