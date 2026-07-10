# Test and Bogus Gateway orders in live data

Shopify's own test mode and the Bogus Gateway used for checkout QA both create real-looking orders that carry a `test` flag set to true. Nothing in the Orders list, in a CSV export, or in a report built on the Admin API filters that flag out on its own, so test orders quietly mix in with live sales and inflate order counts and revenue. This job pages through recent orders, decides which ones are test or bogus-gateway data with a pure function, and tags the untagged ones so reports and automations can exclude them. It never deletes or cancels an order, it only reads and tags.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/test-and-bogus-gateway-orders-in-live-data/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export TEST_ORDER_TAG="test-order"
export DRY_RUN="true"

python test-and-bogus-gateway-orders-in-live-data/python/flag_test_orders.py
node   test-and-bogus-gateway-orders-in-live-data/node/flag-test-orders.js
```

`is_test_order` and `needs_tag` are pure functions that take a plain order object and return a boolean, so the whole decision is testable without a store or a network call. The only write is a tag, so it never touches money or order status. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest test-and-bogus-gateway-orders-in-live-data/python
node --test test-and-bogus-gateway-orders-in-live-data/node
```
