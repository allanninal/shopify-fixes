# Next billing date drifts

A subscription contract's `nextBillingDate` should always land on a date the billing policy actually produces, the origin date plus a whole number of intervals. A pause and resume, a manual edit, or a missed cycle can leave that field sitting on a date the policy never generates, so invoices go out early, late, or not at all. This job recomputes the date the policy implies for each active contract, compares it to the stored value, and calls `subscriptionContractSetNextBillingDate` to realign the ones that drift past a small tolerance.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/next-billing-date-drifts/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export DRIFT_TOLERANCE_DAYS="1"
export DRY_RUN="true"

python next-billing-date-drifts/python/fix_next_billing_date.py
node   next-billing-date-drifts/node/fix-next-billing-date.js
```

`expected_next_billing_date` (Python) and `expectedNextBillingDateMs` (Node) are pure functions that walk the billing policy forward in whole intervals with no network and no clock reads, so the comparison is fully testable. The only write is `subscriptionContractSetNextBillingDate`, and it only runs on contracts whose drift is larger than `DRIFT_TOLERANCE_DAYS`. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest next-billing-date-drifts/python
node --test next-billing-date-drifts/node
```
