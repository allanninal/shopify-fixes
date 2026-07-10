/**
 * Capture Shopify orders whose payment is authorized but never captured.
 *
 * When a store captures payments manually, the order sits at an AUTHORIZED financial
 * status. Shopify holds the authorization for a limited window (about 7 days for
 * Shopify Payments), then it expires and the money is lost. This lists AUTHORIZED
 * orders, keeps the ones with an outstanding capturable amount and a successful
 * authorization transaction, and calls orderCapture. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/authorized-payment-expires-uncaptured/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function authorizationTxn(order) {
  for (const txn of order.transactions || []) {
    if (txn.kind === "AUTHORIZATION" && txn.status === "SUCCESS") return txn;
  }
  return null;
}

export function capturableAmount(order) {
  return order.totalCapturableSet?.shopMoney?.amount ?? null;
}

export function eligibleToCapture(order) {
  if (order.displayFinancialStatus !== "AUTHORIZED") return false;
  const amount = capturableAmount(order);
  if (amount === null || parseFloat(amount) <= 0) return false;
  return authorizationTxn(order) !== null;
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
query($cursor: String) {
  orders(first: 50, after: $cursor, query: "financial_status:authorized") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name displayFinancialStatus
      totalCapturableSet { shopMoney { amount currencyCode } }
      transactions(first: 10) { id kind status }
    }
  }
}`;

const CAPTURE_MUTATION = `
mutation($id: ID!, $amount: MoneyInput!, $parent: ID!) {
  orderCapture(input: { id: $id, amount: $amount, parentTransactionId: $parent, finalCapture: true }) {
    transaction { id status kind }
    userErrors { field message }
  }
}`;

async function* authorizedOrders() {
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function capture(order) {
  const money = order.totalCapturableSet.shopMoney;
  const parent = authorizationTxn(order).id;
  const result = (await gql(CAPTURE_MUTATION, {
    id: order.id,
    amount: { amount: money.amount, currencyCode: money.currencyCode },
    parent,
  })).orderCapture;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let captured = 0;
  for await (const order of authorizedOrders()) {
    if (!eligibleToCapture(order)) continue;
    console.log(`Order ${order.name} eligible. ${DRY_RUN ? "would capture" : "capturing"}`);
    if (!DRY_RUN) await capture(order);
    captured++;
  }
  console.log(`Done. ${captured} order(s) ${DRY_RUN ? "to capture" : "captured"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
