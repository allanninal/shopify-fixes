# Dunning never retries a failed charge

A recurring charge can fail for ordinary reasons: an expired card, a bank decline, a payment gateway timeout. Shopify records the failure on the SubscriptionContract as `lastPaymentStatus` FAILED, but nothing retries it on its own. This job finds active contracts whose last payment failed, reads the contract's own `billingAttempts` history to work out how long it has been failing, and creates a new billing attempt once the right number of days have passed, following a backoff schedule of 1, 3, then 7 days so it never hammers a card that just failed.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/dunning-never-retries-a-failed-charge/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export DRY_RUN="true"

python dunning-never-retries-a-failed-charge/python/retry_failed_billing.py
node   dunning-never-retries-a-failed-charge/node/retry-failed-billing.js
```

`retry_decision` (`retryDecision` in Node) is a pure function that takes a contract and the current time and returns whether a retry is due, so the backoff schedule is fully testable without a network call. Start with `DRY_RUN=true` to see exactly which contracts would be retried before it writes anything.

## Test

```bash
pytest dunning-never-retries-a-failed-charge/python
node --test dunning-never-retries-a-failed-charge/node
```
