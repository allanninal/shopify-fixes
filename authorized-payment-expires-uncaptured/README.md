# Authorized payment expires uncaptured

When a store captures payments manually, the order sits at an AUTHORIZED financial status. Shopify holds the authorization for a limited window (about 7 days for Shopify Payments), then it expires and the money is lost. This job lists AUTHORIZED orders, keeps the ones with an outstanding capturable amount and a successful authorization transaction, and calls `orderCapture` before the hold expires.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/authorized-payment-expires-uncaptured/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export DRY_RUN="true"

python authorized-payment-expires-uncaptured/python/capture_authorized.py
node   authorized-payment-expires-uncaptured/node/capture-authorized.js
```

Eligibility is a pure function: the order must be AUTHORIZED, have a positive `totalCapturableSet`, and carry a successful AUTHORIZATION transaction to capture against. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest authorized-payment-expires-uncaptured/python
node --test authorized-payment-expires-uncaptured/node
```
