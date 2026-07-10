# Available drifted from real on-hand

Shopify's Available count only moves when an order, cancellation, return, or manual adjustment tells it to. A POS miscount, a damaged unit written off without an adjustment, or a failed warehouse sync all change real stock without Shopify ever hearing about it, so Available quietly drifts away from what is actually on the shelf. This job compares a trusted real count (a cycle count file or warehouse feed) against what Shopify reports for each SKU at one location, and corrects only the items whose drift is bigger than a tolerance, using a compare-and-set write so a concurrent sale or return cannot be silently overwritten.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/available-drifted-from-real-on-hand/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export SHOPIFY_LOCATION_ID="gid://shopify/Location/124656943"
export DRIFT_TOLERANCE="1"
export REAL_COUNTS_FILE="real_counts.csv"
export DRY_RUN="true"

python available-drifted-from-real-on-hand/python/reconcile_available.py
node   available-drifted-from-real-on-hand/node/reconcile-available.js
```

`real_counts.csv` needs two columns: `sku,real_count`. `plan_reconciliation` (Python) and `planReconciliation` (Node) are pure functions that work in whole units, so the comparison is fully testable without a network call. The only write is `inventorySetQuantities` with `compareQuantity` set to the last known Shopify value, so a concurrent change makes the write fail instead of overwriting it. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest available-drifted-from-real-on-hand/python
node --test available-drifted-from-real-on-hand/node
```
