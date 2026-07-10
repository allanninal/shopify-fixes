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
