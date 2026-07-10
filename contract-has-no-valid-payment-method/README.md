# Contract has no valid payment method

An active Shopify subscription contract needs a valid payment method to bill on schedule. When the card was removed, the vault entry was revoked by the customer's bank, or the contract was created without one attached, `lastPaymentStatus` can read `NO_PAYMENT_METHOD` and Shopify will keep trying to bill and keep failing quietly. This job pages through active contracts, applies a pure decision function to flag the ones that cannot bill, and tags them for review with `tagsAdd` so a human can email the buyer for a new card. It never touches billing or money itself.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/contract-has-no-valid-payment-method/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export REVIEW_TAG="needs-payment-method"
export DRY_RUN="true"

python contract-has-no-valid-payment-method/python/find_contracts_missing_payment_method.py
node   contract-has-no-valid-payment-method/node/find-contracts-missing-payment-method.js
```

`has_no_valid_payment_method` and `needs_tag` are pure functions with no I/O, so the decision is fully testable without a live store. The only write is a review tag, so it never moves money or touches billing. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest contract-has-no-valid-payment-method/python
node --test contract-has-no-valid-payment-method/node
```
