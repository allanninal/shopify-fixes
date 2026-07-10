/**
 * Find orders whose external id metafield went missing on create, and set it back.
 *
 * Some integrations write a linking key onto the order the moment it is created, usually
 * a metafield such as external_sync.external_id, so a warehouse system, a marketplace, or
 * an ERP can match the Shopify order back to its own record. When the order is created by
 * a flow that skips that write, such as a checkout that bypasses the app, a bulk import, or
 * a race between two systems creating the order at the same time, the metafield is never
 * set and the two systems can no longer find each other.
 *
 * This script reads recent orders, compares the external_sync.external_id metafield against
 * the source of truth id you already have, and only repairs the ones that are missing or
 * wrong, using metafieldsSet. It never touches an order whose metafield already matches.
 * Run on a schedule. Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/external-id-metafield-dropped-on-create/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const METAFIELD_NAMESPACE = process.env.METAFIELD_NAMESPACE || "external_sync";
const METAFIELD_KEY = process.env.METAFIELD_KEY || "external_id";

export function needsRepair(order, expectedExternalId) {
  if (!expectedExternalId) return false;
  const current = order.metafield ? order.metafield.value : null;
  return current !== expectedExternalId;
}

export function planRepairs(orders, externalIdLookup) {
  const plan = [];
  for (const order of orders) {
    const expected = externalIdLookup[order.name];
    if (needsRepair(order, expected)) plan.push([order, expected]);
  }
  return plan;
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
  orders(first: 50, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      metafield(namespace: "external_sync", key: "external_id") { id value }
    }
  }
}`;

const METAFIELDS_SET = `
mutation($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id key value }
    userErrors { field message }
  }
}`;

async function* ordersMissingLink() {
  const q = "created_at:>-7d";
  let cursor = null;
  while (true) {
    const data = (await gql(ORDERS_QUERY, { cursor, q })).orders;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function setExternalId(orderId, externalId) {
  const variables = {
    metafields: [{
      ownerId: orderId,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_KEY,
      type: "single_line_text_field",
      value: externalId,
    }],
  };
  const result = (await gql(METAFIELDS_SET, variables)).metafieldsSet;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.metafields[0].value;
}

export async function run(externalIdLookup = {}) {
  let repaired = 0;
  const orders = [];
  for await (const order of ordersMissingLink()) orders.push(order);
  for (const [order, expected] of planRepairs(orders, externalIdLookup)) {
    console.warn(
      `Order ${order.name} external id metafield ${order.metafield ? "mismatched" : "missing"}. ${DRY_RUN ? "would set" : "setting"}`
    );
    if (!DRY_RUN) await setExternalId(order.id, expected);
    repaired++;
  }
  console.log(`Done. ${repaired} order(s) ${DRY_RUN ? "to repair" : "repaired"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Replace this with a real lookup, for example a query against your order system.
  run({}).catch((err) => { console.error(err); process.exit(1); });
}
