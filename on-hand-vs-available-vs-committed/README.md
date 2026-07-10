# On hand vs available vs committed drift

Shopify tracks three different inventory numbers at every location: `on_hand` (the physical count), `committed` (reserved by open orders), and `available` (what a customer can actually buy). The identity that must hold is `on_hand - committed - damaged - safety_stock = available`. When an app or a manual edit writes to one bucket and not the others, that identity breaks, and the storefront ends up selling stock that is already spoken for, or hiding stock that is genuinely free. This job reads each inventory item's quantities at every location with the `quantities` field on `InventoryLevel`, works out the expected available count, and tags the item for review with `tagsAdd` when the drift is nonzero.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/on-hand-vs-available-vs-committed/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export REVIEW_TAG="inventory-drift"
export DRY_RUN="true"

python on-hand-vs-available-vs-committed/python/find_available_vs_committed_drift.py
node   on-hand-vs-available-vs-committed/node/find-available-vs-committed-drift.js
```

`drift_for_level` and `levels_with_drift` are pure functions that only compare the quantities Shopify already reports, so the check is fully testable and never guesses at stock levels. The only write is a review tag, so it never moves inventory. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest on-hand-vs-available-vs-committed/python
node --test on-hand-vs-available-vs-committed/node
```
