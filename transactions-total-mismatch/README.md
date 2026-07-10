# Transactions total does not match the order

The money on an order should tie out: successful captures minus successful refunds equals the amount received. When they drift apart (a failed refund still counted, a gateway hiccup, a manual edit), the order's ledger is wrong and reports quietly lie. This job sums each recent order's successful transactions, compares them to `totalReceivedSet`, and tags the ones that do not match for review with `tagsAdd`.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/transactions-total-mismatch/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="7"
export REVIEW_TAG="ledger-mismatch"
export DRY_RUN="true"

python transactions-total-mismatch/python/find_ledger_mismatch.py
node   transactions-total-mismatch/node/find-ledger-mismatch.js
```

`net_captured_cents` and `is_mismatch` are pure functions that work in minor units, so the comparison never suffers floating-point drift and is fully testable. The only write is a review tag, so it never moves money. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest transactions-total-mismatch/python
node --test transactions-total-mismatch/node
```
