# Negative or phantom inventory from oversell

When a variant's inventory policy allows selling past zero (CONTINUE), a burst of orders can drive a location's available count below zero. Negative stock skews reports and reorder math. This job lists variants that are oversold, finds the locations where available is negative, and sets them back to zero with `inventorySetQuantities` using `compareQuantity`, so a concurrent change is rejected instead of clobbered.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/negative-inventory-oversell/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export DRY_RUN="true"

python negative-inventory-oversell/python/fix_negative_inventory.py
node   negative-inventory-oversell/node/fix-negative-inventory.js
```

`oversold_levels` is a pure function: it returns exactly the locations where available is below zero, with the inventory item and location ids needed to correct them. Start with `DRY_RUN=true` to review the list first. The write uses `compareQuantity`, so if stock changed since the read, Shopify rejects the write and you re-run.

## Test

```bash
pytest negative-inventory-oversell/python
node --test negative-inventory-oversell/node
```
