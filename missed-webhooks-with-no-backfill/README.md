# Missed webhooks with no backfill

Shopify retries a failing webhook delivery for up to 48 hours, then drops it for good. If your app was down longer than that, some orders never told you they were paid, fulfilled, or cancelled, and nothing will ever resend that message. This job polls orders updated during the outage window, keeps only the ones whose `updatedAt` falls inside that window and that have not already been reprocessed, and replays the missed update by reading the order's current state and tagging it done.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/missed-webhooks-with-no-backfill/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export GAP_START="2026-07-05T00:00:00Z"
export GAP_END="2026-07-06T00:00:00Z"
export BACKFILL_TAG="webhook-backfilled"
export DRY_RUN="true"

python missed-webhooks-with-no-backfill/python/backfill_missed_webhooks.py
node   missed-webhooks-with-no-backfill/node/backfill-missed-webhooks.js
```

`needs_backfill` / `needsBackfill` is a pure function that decides whether an order falls inside the outage window and still needs reprocessing, so it is fully testable without a network call or a Shopify account. Money is read through `summarize` in minor units (cents) to avoid floating point drift. Start with `DRY_RUN=true` to review the list before it writes the backfill tag.

## Test

```bash
pytest missed-webhooks-with-no-backfill/python
node --test missed-webhooks-with-no-backfill/node
```
