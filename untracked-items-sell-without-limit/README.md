# Untracked items sell without limit

A variant with `inventoryItem.tracked` set to `false` has no quantity behind it, so Shopify never counts a sale against it and it never runs out no matter how many orders come in. Some untracked variants are meant to be that way, like services or digital goods, so this job only turns tracking on for variants that are untracked, have real recent sales, and carry a confirmation tag you add once you have reviewed them, using `inventoryItemUpdate`.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/untracked-items-sell-without-limit/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export TRACK_FIX_TAG="track-me"
export MIN_RECENT_SALES="1"
export LOOKBACK_DAYS="30"
export DRY_RUN="true"

python untracked-items-sell-without-limit/python/fix_untracked_items.py
node   untracked-items-sell-without-limit/node/fix-untracked-items.js
```

`eligible_to_track` (Python) and `eligibleToTrack` (Node) are pure functions with no network calls, so the decision is fully testable on its own. The only write is `inventoryItemUpdate` flipping tracking on for a confirmed variant, so it never touches price, stock counts, or checkout. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest untracked-items-sell-without-limit/python
node --test untracked-items-sell-without-limit/node
```
