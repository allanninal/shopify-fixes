# Renewal fails on an expired card

A subscription renewal fails when the card on the contract has expired or the payment method was revoked. Instead of waiting for the failed billing attempt and the churn that follows, this job walks the active contracts, finds the ones whose card is expired or whose method is gone, and sends the built-in update-payment-method email with `customerPaymentMethodSendUpdateEmail`.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/renewal-fails-expired-card/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export DRY_RUN="true"

python renewal-fails-expired-card/python/notify_expired_cards.py
node   renewal-fails-expired-card/node/notify-expired-cards.js
```

`needs_update` and `card_expired` are pure functions: a contract is emailed only when it is ACTIVE and its payment method is revoked or its card is expired. The date is passed in, so the logic is fully testable. Start with `DRY_RUN=true` to review the list first. The job dedupes by payment method so a customer is emailed once even with several contracts.

## Test

```bash
pytest renewal-fails-expired-card/python
node --test renewal-fails-expired-card/node
```
