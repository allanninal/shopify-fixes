# Partial refund leaves the tax untouched

A partial refund that only sets a refund line item amount, with no matching tax adjustment, gives the customer back the item but keeps the tax they paid on it. This job walks recent orders with partial refunds, works out the tax that should have come back for each refund (proportional to what the order originally charged), compares it to the tax Shopify actually refunded, and when the gap is real it issues a follow-up refund for the missing tax only. It never touches a refund that already ties out.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/partial-refund-leaves-the-tax-untouched/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="14"
export MIN_GAP_CENTS="2"
export DRY_RUN="true"

python partial-refund-leaves-the-tax-untouched/python/find_untaxed_partial_refunds.py
node   partial-refund-leaves-the-tax-untouched/node/find-untaxed-partial-refunds.js
```

`untaxed_refund_gap_cents` (`untaxedRefundGapCents` in Node) is a pure function that works in minor units, so the comparison never suffers floating-point drift and is fully testable. Start with `DRY_RUN=true` to review the list of underrefunded orders before letting it write a correction refund.

## Test

```bash
pytest partial-refund-leaves-the-tax-untouched/python
node --test partial-refund-leaves-the-tax-untouched/node/*.test.js
```
