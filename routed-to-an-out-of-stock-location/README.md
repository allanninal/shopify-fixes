# Routed to an out-of-stock location

An order can be assigned to a fulfillment location that has nothing to pick for one or more line items, often because a location rule or the shipping address routed it there before a stock count caught up. Shopify will not let staff fulfill from a location with no usable inventory, so the order stalls at OPEN or IN_PROGRESS. This job lists the fulfillment orders stuck at a known problem location, asks Shopify which other locations could take the line items with `locationsForMove`, picks the best candidate in pure code, and calls `fulfillmentOrderMove` to reassign it.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/routed-to-an-out-of-stock-location/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export OUT_OF_STOCK_LOCATION_ID="gid://shopify/Location/123456789"
export DRY_RUN="true"

python routed-to-an-out-of-stock-location/python/reroute_out_of_stock_fulfillment.py
node   routed-to-an-out-of-stock-location/node/reroute-out-of-stock-fulfillment.js
```

`pick_reroute_location` (`pickRerouteLocation` in Node) is a pure function that never touches the network. It only recommends a location that can cover every remaining line item, so the order never gets split into two shipments by accident. Start with `DRY_RUN=true` to review the list before it moves anything.

## Test

```bash
pytest routed-to-an-out-of-stock-location/python
node --test routed-to-an-out-of-stock-location/node
```
