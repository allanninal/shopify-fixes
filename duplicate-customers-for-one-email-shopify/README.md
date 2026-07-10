# Duplicate customers for one email

The same shopper often ends up as two or three separate Shopify customer records that all resolve to the same mailbox, one from a guest checkout, one from an account, one from a slightly different capitalization. Order history, store credit, and marketing consent all get split across them. This job groups customers by a normalized email, keeps the record with the most orders as the survivor (the older record as the tiebreaker), previews the merge with `customerMergePreview`, and calls `customerMerge` to fold a clean duplicate pair into one customer.

**Full guide with diagrams:** https://www.allanninal.dev/shopify/duplicate-customers-for-one-email-shopify/

## Run it

```bash
export SHOPIFY_SHOP="yourstore.myshopify.com"
export SHOPIFY_ACCESS_TOKEN="shpat_..."
export DRY_RUN="true"

python duplicate-customers-for-one-email-shopify/python/find_duplicate_customers.py
node   duplicate-customers-for-one-email-shopify/node/find-duplicate-customers.js
```

`group_by_email`, `choose_survivor`, and `plan_merge` are pure functions with no I/O, so the merge decision is fully testable without a Shopify store. The script only merges a group when it is exactly two customers, neither is tagged `do-not-merge`, and Shopify's own merge preview reports no conflicting fields. Start with `DRY_RUN=true` to review the list first.

## Test

```bash
pytest duplicate-customers-for-one-email-shopify/python
node --test duplicate-customers-for-one-email-shopify/node
```
