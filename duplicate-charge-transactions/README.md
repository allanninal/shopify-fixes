# Duplicate charge from duplicate transactions

A retry, a double click, or an app that captured an order more than once can leave two successful SALE or CAPTURE transactions of the same amount on one Shopify order, so the customer is charged twice. This lists recent orders, finds the duplicate successful charges (every same-amount charge after the first), and refunds the extras with `refundCreate`.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/duplicate-charge-transactions/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="7"
export DRY_RUN="true"

python duplicate-charge-transactions/python/find_duplicate_charges.py
node   duplicate-charge-transactions/node/find-duplicate-charges.js
```

`duplicate_sale_transactions` is a pure function, so the detection is easy to test and never counts a failed charge or a refund as a duplicate. Start with `DRY_RUN=true` to review the list before any money moves.

## Test

```bash
pytest duplicate-charge-transactions/python
node --test duplicate-charge-transactions/node
```
