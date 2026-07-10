# Billing runs on a cancelled contract

Cancelling a Shopify `SubscriptionContract` stops future billing cycles, but a billing attempt that was already queued (or that a retry re-queued) can still land and create an order after the contract's status flips to `CANCELLED`. The order looks ordinary, and the customer gets charged for a subscription they already cancelled. This job walks recent cancelled or expired subscription contracts, reads their billing attempts, and tags the resulting order for review with `tagsAdd` whenever an attempt ran, or is still pending, after the contract's `cancelledAt` timestamp.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/billing-runs-on-a-cancelled-contract/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export REVIEW_TAG="billed-after-cancel"
export DRY_RUN="true"

python billing-runs-on-a-cancelled-contract/python/flag_attempts_after_cancel.py
node   billing-runs-on-a-cancelled-contract/node/flag-attempts-after-cancel.js
```

`attempt_ran_after_cancel` (`attemptRanAfterCancel` in Node) is a pure function that compares a billing attempt's `createdAt` against the contract's `cancelledAt`, so it is fully testable with plain objects and no network. The only write is a review tag, so it never moves money or cancels an order for you. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest billing-runs-on-a-cancelled-contract/python
node --test billing-runs-on-a-cancelled-contract/node
```
