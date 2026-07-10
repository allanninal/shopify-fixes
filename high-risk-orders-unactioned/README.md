# High-risk orders left unactioned

Shopify scores every order for fraud risk, but a HIGH risk order still ships if nobody looks at it. This job lists recent open (unfulfilled, not cancelled) orders, keeps the ones Shopify rated high risk or recommended to cancel that are not already tagged, and adds a review tag with `tagsAdd` so staff catch them before fulfillment.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/high-risk-orders-unactioned/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export REVIEW_TAG="fraud-review"
export DRY_RUN="true"

python high-risk-orders-unactioned/python/flag_high_risk.py
node   high-risk-orders-unactioned/node/flag-high-risk.js
```

`needs_review` is a pure function: it only flags a high-risk order that is open, not cancelled, and not already tagged, so re-running never re-tags the same order. Start with `DRY_RUN=true` to review the list first. Tagging is safe (it never cancels or refunds); a human still makes the call.

## Test

```bash
pytest high-risk-orders-unactioned/python
node --test high-risk-orders-unactioned/node
```
