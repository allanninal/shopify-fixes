/**
 * Find Shopify orders that were charged twice and refund the extra charge.
 *
 * A retry, a double click, or an app that captured an order more than once can
 * leave two successful SALE or CAPTURE transactions of the same amount on one
 * order. This lists recent orders, finds the duplicate successful charges, and
 * refunds the extras with refundCreate. Run on a schedule. Safe to run again.
 *
 * Guide: https://www.allanninal.dev/shopify/duplicate-charge-transactions/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 7);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CHARGE_KINDS = new Set(["SALE", "CAPTURE"]);

export function duplicateSaleTransactions(transactions) {
  const seen = new Set();
  const extras = [];
  for (const t of transactions || []) {
    if (CHARGE_KINDS.has(t.kind) && t.status === "SUCCESS") {
      const amount = t.amountSet.shopMoney.amount;
      if (seen.has(amount)) extras.push(t);
      else seen.add(amount);
    }
  }
  return extras;
}

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}`);
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

const ORDERS_QUERY = `
query($cursor: String, $q: String!) {
  orders(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name
      transactions(first: 20) {
        id kind status
        amountSet { shopMoney { amount currencyCode } }
      }
    }
  }
}`;

const REFUND_MUTATION = `
mutation($input: RefundInput!) {
  refundCreate(input: $input) {
    refund { id }
    userErrors { field message }
  }
}`;

async function* recentOrders() {
  const q = `created_at:>-${LOOKBACK_DAYS}d`;
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor, q })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function refund(orderId, txn) {
  const money = txn.amountSet.shopMoney;
  const result = (await gql(REFUND_MUTATION, {
    input: {
      orderId,
      transactions: [{ parentId: txn.id, amount: money.amount, gateway: "shopify_payments", kind: "REFUND" }],
    },
  })).refundCreate;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let refunded = 0;
  for await (const order of recentOrders()) {
    for (const txn of duplicateSaleTransactions(order.transactions)) {
      const money = txn.amountSet.shopMoney;
      console.warn(`Order ${order.name} has a duplicate charge of ${money.amount} ${money.currencyCode}. ${DRY_RUN ? "would refund" : "refunding"}`);
      if (!DRY_RUN) await refund(order.id, txn);
      refunded++;
    }
  }
  console.log(`Done. ${refunded} duplicate charge(s) ${DRY_RUN ? "to refund" : "refunded"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
