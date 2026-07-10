# Overselling from concurrent writes

Two writers, such as a checkout and a warehouse sync, can each read the same available quantity for a variant and then both write a new absolute value back. Whichever write lands last wins completely and silently erases the other one, so the store's count drifts above what is really on the shelf and it oversells. This job reads the live available quantity right before writing and passes it as `compareQuantity` on `inventorySetQuantities`, so Shopify rejects the write instead of silently overwriting a change made by another process in between.

**Full guide:** https://www.allanninal.dev/shopify/overselling-from-concurrent-writes/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOCATION_ID="gid://shopify/Location/1"
export DRY_RUN="true"

python overselling-from-concurrent-writes/python/reconcile_inventory.py
node   overselling-from-concurrent-writes/node/reconcile-inventory.js
```

`plan_write` and `available_quantity` are pure functions with no network calls, so the write decision and the compareQuantity guard are fully testable. A rejected write from a stale `compareQuantity` never corrupts anything, it just waits for the next pass to re-read and try again. Start with `DRY_RUN=true` to review the planned corrections first.

## Test

```bash
pytest overselling-from-concurrent-writes/python
node --test overselling-from-concurrent-writes/node
```
