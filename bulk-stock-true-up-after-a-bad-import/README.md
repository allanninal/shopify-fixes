# Bulk stock true-up after a bad import

A bad bulk import (a bad CSV, a stuck sync app) can stamp the wrong `available` quantity onto many items at once. This script reads a trusted snapshot (the counts you captured before the bad import, keyed by SKU and location), reads each item's live quantity from Shopify, and only corrects items where the drift is real and inside a sane guard. It writes with `inventorySetQuantities` using `compareQuantity`, so a sale that lands between the read and the write is never silently overwritten, and it applies fixes in small batches.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/bulk-stock-true-up-after-a-bad-import/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export SHOPIFY_LOCATION_ID="gid://shopify/Location/123456789"
export SNAPSHOT_PATH="snapshot.csv"   # columns: sku,available
export MAX_ADJUST="500"
export BATCH_SIZE="25"
export DRY_RUN="true"

python bulk-stock-true-up-after-a-bad-import/python/true_up_inventory.py
node   bulk-stock-true-up-after-a-bad-import/node/true-up-inventory.js
```

`plan_correction` / `planCorrection` is a pure function that works in plain integers, so the comparison never depends on the network and is fully testable. It skips SKUs missing from the snapshot, skips items that already match, and skips any drift bigger than `MAX_ADJUST`, since a swing that large usually means a second bad file, not real shrinkage. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest bulk-stock-true-up-after-a-bad-import/python
node --test bulk-stock-true-up-after-a-bad-import/node
```
