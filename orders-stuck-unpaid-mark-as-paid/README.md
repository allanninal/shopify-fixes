# Orders stuck unpaid, mark as paid

Orders paid outside standard checkout (bank transfer, cash on delivery, an external processor) sit at a Pending financial status even after the money arrives, blocking fulfillment and understating revenue. This repair finds eligible orders (`canMarkAsPaid` true, status Pending or Partially paid) that carry a confirmation tag and calls `orderMarkAsPaid`, which records a payment and flips the order to Paid.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/orders-stuck-unpaid-mark-as-paid/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export MARK_PAID_TAG="paid-externally"
export DRY_RUN="true"

python orders-stuck-unpaid-mark-as-paid/python/mark_paid.py
node   orders-stuck-unpaid-mark-as-paid/node/mark-paid.js
```

Guarded on `canMarkAsPaid` so it never errors on orders that are already paid, cancelled, or have pending Shopify Payments transactions.

## Test

```bash
pytest orders-stuck-unpaid-mark-as-paid/python
node --test orders-stuck-unpaid-mark-as-paid/node
```
