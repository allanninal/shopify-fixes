# Processing fee not recorded on the order

The order total is what the customer paid, not what you kept. Shopify Payments deducts its processing fee from the payout separately, and that fee lives on the order's own transactions as a `TransactionFee`, never on the order itself. This job sums the fee on each recent order's successful sale and capture transactions and writes it back onto the order as a metafield in cents, once, so reports and accounting syncs can compute net revenue without a second trip to the payout report.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/processing-fee-not-recorded-on-the-order/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export LOOKBACK_DAYS="14"
export FEE_METAFIELD_NAMESPACE="recon"
export FEE_METAFIELD_KEY="processing_fee_cents"
export DRY_RUN="true"

python processing-fee-not-recorded-on-the-order/python/record_processing_fee.py
node   processing-fee-not-recorded-on-the-order/node/record-processing-fee.js
```

`fee_cents_for_order` is a pure function that works in minor units, so the fee total never suffers floating-point drift and is fully testable. It skips any order that already carries the metafield, so the job never overwrites a value or double counts. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest processing-fee-not-recorded-on-the-order/python
node --test processing-fee-not-recorded-on-the-order/node
```
