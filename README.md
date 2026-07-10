# Shopify Fixes

Small, tested Python and Node.js scripts that detect and repair real problems on **Shopify** stores. Stuck unpaid orders, uncaptured authorizations, lost webhooks, duplicate charges, payout and refund reconciliation, subscription billing failures, inventory drift, and stuck fulfillments.

Every fix is safe by default. The scripts start in a dry run mode that reports what they would do, so you can read the plan before anything writes.

By **[Allan Niñal](https://github.com/allanninal)** — AI Solutions Engineer. I build AI powered tools, data products, and AWS automation.
Full write ups with diagrams for each fix live at **[allanninal.dev/shopify](https://www.allanninal.dev/shopify/)**.

[![Follow on GitHub](https://img.shields.io/github/followers/allanninal?label=Follow%20%40allanninal&style=social)](https://github.com/allanninal)
[![Tests](https://github.com/allanninal/shopify-fixes/actions/workflows/tests.yml/badge.svg)](https://github.com/allanninal/shopify-fixes/actions/workflows/tests.yml)

## How the scripts work

Every fix talks to Shopify through the **Admin GraphQL API**. You need a shop domain and an Admin API access token with the scopes the fix uses.

- **Python** posts GraphQL with `requests`.
- **Node.js** posts GraphQL with the built in `fetch` (Node 18 or newer), no dependencies.

Money is read as both `shopMoney` and `presentmentMoney`. Large scans use `bulkOperationRunQuery`. Webhooks are deduped on `X-Shopify-Webhook-Id`.

## Setup

Create a custom app in your Shopify admin, install it, and copy the Admin API access token.

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export DRY_RUN="true"   # start safe
```

Python needs `pip install requests`. Node needs Node 18 or newer.

## The fixes

| Fix | What it does | Type | Guide |
|---|---|---|---|
| [orders-stuck-unpaid-mark-as-paid](./orders-stuck-unpaid-mark-as-paid/) | Mark externally paid orders as paid (guarded) | Repair | [Read](https://www.allanninal.dev/shopify/orders-stuck-unpaid-mark-as-paid/) |
| [authorized-payment-expires-uncaptured](./authorized-payment-expires-uncaptured/) | Capture authorized orders before the hold expires | Reconciler | [Read](https://www.allanninal.dev/shopify/authorized-payment-expires-uncaptured/) |
| [duplicate-charge-transactions](./duplicate-charge-transactions/) | Detect and refund a duplicate charge on an order | Repair | [Read](https://www.allanninal.dev/shopify/duplicate-charge-transactions/) |
| [high-risk-orders-unactioned](./high-risk-orders-unactioned/) | Tag high-risk orders for review before they ship | Diagnostic | [Read](https://www.allanninal.dev/shopify/high-risk-orders-unactioned/) |
| [negative-inventory-oversell](./negative-inventory-oversell/) | Reset oversold variants from negative back to zero | Repair | [Read](https://www.allanninal.dev/shopify/negative-inventory-oversell/) |
| [renewal-fails-expired-card](./renewal-fails-expired-card/) | Email subscribers with an expired/revoked card before renewal | Reconciler | [Read](https://www.allanninal.dev/shopify/renewal-fails-expired-card/) |
| [transactions-total-mismatch](./transactions-total-mismatch/) | Flag orders whose transactions do not tie out | Diagnostic | [Read](https://www.allanninal.dev/shopify/transactions-total-mismatch/) |
| [orders-stuck-unfulfilled](./orders-stuck-unfulfilled/) | Tag paid orders overdue past the fulfillment SLA | Diagnostic | [Read](https://www.allanninal.dev/shopify/orders-stuck-unfulfilled/) |
| [3pl-fulfillment-out-of-sync](./3pl-fulfillment-out-of-sync/) | 3PL fulfillment out of sync | Reconciler | [Read](https://www.allanninal.dev/shopify/3pl-fulfillment-out-of-sync/) |
| [available-drifted-from-real-on-hand](./available-drifted-from-real-on-hand/) | Available drifted from real on-hand | Reconciler | [Read](https://www.allanninal.dev/shopify/available-drifted-from-real-on-hand/) |
| [billing-runs-on-a-cancelled-contract](./billing-runs-on-a-cancelled-contract/) | Billing runs on a cancelled contract | Reconciler | [Read](https://www.allanninal.dev/shopify/billing-runs-on-a-cancelled-contract/) |
| [bulk-stock-true-up-after-a-bad-import](./bulk-stock-true-up-after-a-bad-import/) | Bulk stock true-up after a bad import | Reconciler | [Read](https://www.allanninal.dev/shopify/bulk-stock-true-up-after-a-bad-import/) |
| [chargeback-pulled-funds-order-still-paid](./chargeback-pulled-funds-order-still-paid/) | Chargeback pulled funds, order still Paid | Reconciler | [Read](https://www.allanninal.dev/shopify/chargeback-pulled-funds-order-still-paid/) |
| [contract-has-no-valid-payment-method](./contract-has-no-valid-payment-method/) | Contract has no valid payment method | Diagnostic | [Read](https://www.allanninal.dev/shopify/contract-has-no-valid-payment-method/) |
| [dunning-never-retries-a-failed-charge](./dunning-never-retries-a-failed-charge/) | Dunning never retries a failed charge | Repair | [Read](https://www.allanninal.dev/shopify/dunning-never-retries-a-failed-charge/) |
| [duplicate-customers-for-one-email-shopify](./duplicate-customers-for-one-email-shopify/) | Duplicate customers for one email | Reconciler | [Read](https://www.allanninal.dev/shopify/duplicate-customers-for-one-email-shopify/) |
| [duplicate-webhook-deliveries-run-twice](./duplicate-webhook-deliveries-run-twice/) | Duplicate webhook deliveries run twice | Reconciler | [Read](https://www.allanninal.dev/shopify/duplicate-webhook-deliveries-run-twice/) |
| [external-id-metafield-dropped-on-create](./external-id-metafield-dropped-on-create/) | External id metafield dropped on create | Repair | [Read](https://www.allanninal.dev/shopify/external-id-metafield-dropped-on-create/) |
| [fulfillment-stuck-on-hold](./fulfillment-stuck-on-hold/) | Fulfillment stuck On hold | Repair | [Read](https://www.allanninal.dev/shopify/fulfillment-stuck-on-hold/) |
| [missed-webhooks-with-no-backfill](./missed-webhooks-with-no-backfill/) | Missed webhooks with no backfill | Reconciler | [Read](https://www.allanninal.dev/shopify/missed-webhooks-with-no-backfill/) |
| [next-billing-date-drifts](./next-billing-date-drifts/) | Next billing date drifts | Reconciler | [Read](https://www.allanninal.dev/shopify/next-billing-date-drifts/) |
| [on-hand-vs-available-vs-committed](./on-hand-vs-available-vs-committed/) | On hand vs available vs committed drift | Diagnostic | [Read](https://www.allanninal.dev/shopify/on-hand-vs-available-vs-committed/) |
| [paid-checkouts-stranded-as-abandoned](./paid-checkouts-stranded-as-abandoned/) | Paid checkouts stranded as abandoned | Reconciler | [Read](https://www.allanninal.dev/shopify/paid-checkouts-stranded-as-abandoned/) |
| [partial-refund-leaves-the-tax-untouched](./partial-refund-leaves-the-tax-untouched/) | Partial refund leaves the tax untouched | Repair | [Read](https://www.allanninal.dev/shopify/partial-refund-leaves-the-tax-untouched/) |
| [presentment-vs-settlement-currency-shopify](./presentment-vs-settlement-currency-shopify/) | Presentment vs settlement currency | Reconciler | [Read](https://www.allanninal.dev/shopify/presentment-vs-settlement-currency-shopify/) |
| [processing-fee-not-recorded-on-the-order](./processing-fee-not-recorded-on-the-order/) | Processing fee not recorded on the order | Reconciler | [Read](https://www.allanninal.dev/shopify/processing-fee-not-recorded-on-the-order/) |
| [reconcile-orders-against-payouts](./reconcile-orders-against-payouts/) | Reconcile orders against payouts | Reconciler | [Read](https://www.allanninal.dev/shopify/reconcile-orders-against-payouts/) |
| [refund-exists-but-the-money-never-moved](./refund-exists-but-the-money-never-moved/) | Refund exists but the money never moved | Reconciler | [Read](https://www.allanninal.dev/shopify/refund-exists-but-the-money-never-moved/) |
| [routed-to-an-out-of-stock-location](./routed-to-an-out-of-stock-location/) | Routed to an out-of-stock location | Repair | [Read](https://www.allanninal.dev/shopify/routed-to-an-out-of-stock-location/) |
| [test-and-bogus-gateway-orders-in-live-data](./test-and-bogus-gateway-orders-in-live-data/) | Test and Bogus Gateway orders in live data | Reconciler | [Read](https://www.allanninal.dev/shopify/test-and-bogus-gateway-orders-in-live-data/) |
| [untracked-items-sell-without-limit](./untracked-items-sell-without-limit/) | Untracked items sell without limit | Diagnostic | [Read](https://www.allanninal.dev/shopify/untracked-items-sell-without-limit/) |
| [webhook-hmac-check-keeps-failing](./webhook-hmac-check-keeps-failing/) | Webhook HMAC check keeps failing | Diagnostic | [Read](https://www.allanninal.dev/shopify/webhook-hmac-check-keeps-failing/) |
| [webhook-subscription-auto-deleted](./webhook-subscription-auto-deleted/) | Webhook subscription auto-deleted | Repair | [Read](https://www.allanninal.dev/shopify/webhook-subscription-auto-deleted/) |
| [duplicate-renewal-charges](./duplicate-renewal-charges/) | Duplicate renewal charges | Reconciler | [Read](https://www.allanninal.dev/shopify/duplicate-renewal-charges/) |
| [overselling-from-concurrent-writes](./overselling-from-concurrent-writes/) | Overselling from concurrent writes | Reconciler | [Read](https://www.allanninal.dev/shopify/overselling-from-concurrent-writes/) |
| [selling-plan-deleted-after-app-uninstall](./selling-plan-deleted-after-app-uninstall/) | Selling plan deleted after app uninstall | Repair | [Read](https://www.allanninal.dev/shopify/selling-plan-deleted-after-app-uninstall/) |

More fixes land as the guides are published. Watch or star the repo to follow along.

## Running the tests

The decision logic in every fix is a pure function with no network calls, so the tests run anywhere.

```bash
# Python
pip install pytest
pytest

# Node
node --test
```

## A note on safety

These scripts can change orders, capture payments, issue refunds, and adjust inventory. Always run with `DRY_RUN=true` first, read the output, and confirm it is correct before you let a script write. Test against a development store when you can.

## Work with me

Fighting a Shopify orders, payments, subscriptions, or inventory bug you would rather hand off? That is what I do.

- GitHub: [github.com/allanninal](https://github.com/allanninal)
- LinkedIn: [in/allanninal](https://www.linkedin.com/in/allanninal/)
- Support the work: [ko-fi.com/allanninal](https://ko-fi.com/allanninal)

## License

MIT. Use it, change it, ship it.
