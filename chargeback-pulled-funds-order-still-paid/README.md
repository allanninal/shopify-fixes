# Chargeback pulled funds, order still Paid

A chargeback pulls the disputed amount through the card network the moment it opens, but Shopify does not flip `displayFinancialStatus` when a dispute is filed. The order keeps reading Paid or Partially refunded while the money is already gone, so it slips past reconciliation and revenue reports until the dispute is finalized weeks later. This job lists recently paid orders, reads their `disputes`, and tags the ones with an open chargeback so the order carries the true state. It never touches money, it only writes a tag.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/chargeback-pulled-funds-order-still-paid/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="30"
export CHARGEBACK_TAG="chargeback-open"
export DRY_RUN="true"

python chargeback-pulled-funds-order-still-paid/python/flag_open_chargebacks.py
node   chargeback-pulled-funds-order-still-paid/node/flag-open-chargebacks.js
```

`needs_flag` (Python) and `needsFlag` (Node) are pure functions that take an order and a required tag and return true or false, so the decision is fully testable without a Shopify account. Money is only read to log the disputed amount in minor units, never compared with floating point. Start with `DRY_RUN=true` to review the exact list before it writes anything.

## Test

```bash
pytest chargeback-pulled-funds-order-still-paid/python
node --test chargeback-pulled-funds-order-still-paid/node
```
