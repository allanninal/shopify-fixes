/**
 * Mark Shopify orders that were paid outside checkout as Paid, safely.
 * Only touches orders that are eligible (canMarkAsPaid) and carry a confirmation tag.
 * Run on a schedule. Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/orders-stuck-unpaid-mark-as-paid/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const MARK_TAG = process.env.MARK_PAID_TAG || "paid-externally";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const ELIGIBLE_STATUSES = new Set(["PENDING", "PARTIALLY_PAID"]);

export function eligibleToMark(order, requiredTag) {
  if (!order.canMarkAsPaid) return false;
  if (!ELIGIBLE_STATUSES.has(order.displayFinancialStatus)) return false;
  return (order.tags || []).includes(requiredTag);
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
  orders(first: 50, after: $cursor, query: "financial_status:pending OR financial_status:partially_paid") {
    pageInfo { hasNextPage endCursor }
    nodes { id name displayFinancialStatus canMarkAsPaid tags }
  }
}`;

const MARK_MUTATION = `
mutation($id: ID!) {
  orderMarkAsPaid(input: { id: $id }) {
    order { id displayFinancialStatus }
    userErrors { field message }
  }
}`;

async function* orders() {
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function markPaid(orderId) {
  const result = (await gql(MARK_MUTATION, { id: orderId })).orderMarkAsPaid;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let fixed = 0;
  for await (const order of orders()) {
    if (!eligibleToMark(order, MARK_TAG)) continue;
    console.log(`Order ${order.name} eligible. ${DRY_RUN ? "dry run" : "marking paid"}`);
    if (!DRY_RUN) await markPaid(order.id);
    fixed++;
  }
  console.log(`Done. ${fixed} order(s) ${DRY_RUN ? "to mark" : "marked paid"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
