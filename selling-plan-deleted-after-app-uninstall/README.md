# Selling plan deleted after app uninstall

When a subscriptions app owns a `SellingPlanGroup` and the merchant uninstalls that app, Shopify deletes every selling plan group the app owns. The product itself survives, but its selling plan group count drops to zero, so the subscribe and save option silently disappears from the storefront and checkout. This job scans products that are supposed to be subscribable (tagged), finds the ones that lost their selling plan group, recreates a merchant-owned replacement with an equivalent discount and delivery policy, and reattaches it with `sellingPlanGroupAddProducts`.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/selling-plan-deleted-after-app-uninstall/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export SUBSCRIBABLE_TAG="subscribe-and-save"
export PLAN_NAME="Subscribe and save"
export DISCOUNT_PERCENT="10"
export DELIVERY_INTERVAL="MONTH"
export DELIVERY_INTERVAL_COUNT="1"
export DRY_RUN="true"

python selling-plan-deleted-after-app-uninstall/python/rebuild_selling_plan.py
node   selling-plan-deleted-after-app-uninstall/node/rebuild-selling-plan.js
```

`needs_selling_plan` (Python) and `needsSellingPlan` (Node) are pure functions that only look at a product's tags and its `sellingPlanGroupsCount`, so the decision is fully testable without a Shopify account. Discount math is kept in minor units (cents) so it never suffers floating point drift. Start with `DRY_RUN=true` to review the exact list of products before the script creates or attaches anything.

## Test

```bash
pytest selling-plan-deleted-after-app-uninstall/python
node --test selling-plan-deleted-after-app-uninstall/node
```
