# Presentment vs settlement currency

The buyer paid in one currency, the presentment currency they saw at checkout, and your store settled in another, the settlement currency your payout actually lands in. Every order carries both amounts on `totalReceivedSet`, `shopMoney` for the settlement side and `presentmentMoney` for what the buyer saw. When a report reads the wrong side, or a broken conversion leaves the two out of step, the numbers quietly stop matching the bank. This job reads both sides of recent orders, works out the implied exchange rate in minor units, and tags for review any order whose currency pair looks unexpected or whose rate falls outside a sane band.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/presentment-vs-settlement-currency-shopify/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="7"
export SETTLEMENT_CURRENCY="USD"
export REVIEW_TAG="currency-mismatch"
export MIN_RATE="0.01"
export MAX_RATE="100"
export DRY_RUN="true"

python presentment-vs-settlement-currency-shopify/python/find_currency_mismatch.py
node   presentment-vs-settlement-currency-shopify/node/find-currency-mismatch.js
```

## Test

```bash
pytest presentment-vs-settlement-currency-shopify/python
node --test presentment-vs-settlement-currency-shopify/node
```

`needs_review` (Python) and `needsReview` (Node) are pure functions that work in minor units, so the comparison never suffers floating-point drift and is fully testable without a Shopify account. The only write is a review tag, so it never moves money or touches the order total. Start with `DRY_RUN=true` to review the list first.
