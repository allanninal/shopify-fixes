# External id metafield dropped on create

Some integrations write a linking key onto the order the moment it is created, usually a metafield such as `external_sync.external_id`, so a warehouse system, a marketplace, or an ERP can match the Shopify order back to its own record. When the order is created by a flow that skips that write, such as a checkout that bypasses the app, a bulk import, or a race between two systems creating the order at the same time, the metafield is never set and the two systems can no longer find each other. This job reads recent orders, compares the metafield against the external id you already have on file, and repairs only the ones that are missing or wrong with `metafieldsSet`.

**Full guide:** https://www.allanninal.dev/shopify/external-id-metafield-dropped-on-create/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export METAFIELD_NAMESPACE="external_sync"
export METAFIELD_KEY="external_id"
export DRY_RUN="true"

python external-id-metafield-dropped-on-create/python/repair_external_id_metafield.py
node   external-id-metafield-dropped-on-create/node/repair-external-id-metafield.js
```

Both scripts expect you to supply an order name to external id lookup from your own system of record; wire that into `run()` before switching `DRY_RUN` off. `needs_repair` and `plan_repairs` are pure functions, so the decision of what to fix is fully testable without a network call, and nothing is written until Shopify's own value is confirmed to differ from yours.

## Test

```bash
pytest external-id-metafield-dropped-on-create/python
node --test external-id-metafield-dropped-on-create/node
```
