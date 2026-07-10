/**
 * Find Shopify customers who share one email under separate customer records,
 * and merge the duplicates into a single customer, safely.
 *
 * A customer with a guest checkout, then an account, then a second guest
 * checkout under a slightly different capitalized email often ends up as two
 * or three customer records that all resolve to the same mailbox. Order
 * history, store credit, and marketing consent all get split across them.
 * This job groups customers by a normalized email, keeps the record with the
 * most orders as the survivor (oldest as the tiebreaker), and calls
 * customerMerge to fold the rest into it. It skips any group that is not a
 * clean two-customer merge, since that is what the current customerMerge
 * mutation supports, and it skips a group when Shopify's own merge preview
 * reports a conflicting field that needs a human pick. Run on a schedule.
 * Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/duplicate-customers-for-one-email-shopify/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CUSTOMERS_QUERY = `
query($cursor: String) {
  customers(first: 50, after: $cursor, sortKey: NAME) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      email
      createdAt
      numberOfOrders
      amountSpent { amount currencyCode }
    }
  }
}`;

const MERGE_PREVIEW_QUERY = `
query($customerOneId: ID!, $customerTwoId: ID!) {
  customerMergePreview(customerOneId: $customerOneId, customerTwoId: $customerTwoId) {
    resultingCustomer { defaultEmail }
    conflictingFields { description }
  }
}`;

const MERGE_MUTATION = `
mutation($customerOneId: ID!, $customerTwoId: ID!) {
  customerMerge(customerOneId: $customerOneId, customerTwoId: $customerTwoId) {
    resultingCustomer { id email }
    jobId
    userErrors { field message }
  }
}`;

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

export function groupByEmail(customers) {
  const groups = new Map();
  for (const customer of customers) {
    const key = normalizeEmail(customer.email);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(customer);
  }
  const duplicates = {};
  for (const [email, nodes] of groups) {
    if (nodes.length > 1) duplicates[email] = nodes;
  }
  return duplicates;
}

export function chooseSurvivor(duplicates) {
  return [...duplicates].sort((a, b) => {
    const ordersDiff = (b.numberOfOrders || 0) - (a.numberOfOrders || 0);
    if (ordersDiff !== 0) return ordersDiff;
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  })[0];
}

export function planMerge(duplicates) {
  if (duplicates.length !== 2) {
    return { action: "skip", reason: "group is not exactly two customers" };
  }
  for (const customer of duplicates) {
    if ((customer.tags || []).includes("do-not-merge")) {
      return { action: "skip", reason: "a customer in this group is protected" };
    }
  }
  const survivor = chooseSurvivor(duplicates);
  const loser = duplicates[0] === survivor ? duplicates[1] : duplicates[0];
  return { action: "merge", survivor, loser };
}

export function mergePreviewIsClean(preview) {
  return !(preview && preview.conflictingFields && preview.conflictingFields.length);
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

async function previewMerge(customerOneId, customerTwoId) {
  const data = await gql(MERGE_PREVIEW_QUERY, { customerOneId, customerTwoId });
  return data.customerMergePreview;
}

async function mergeCustomers(customerOneId, customerTwoId) {
  const result = (await gql(MERGE_MUTATION, { customerOneId, customerTwoId })).customerMerge;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.resultingCustomer;
}

async function* allCustomers() {
  let cursor = null;
  while (true) {
    const data = (await gql(CUSTOMERS_QUERY, { cursor })).customers;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

export async function run() {
  const customers = [];
  for await (const customer of allCustomers()) customers.push(customer);
  const groups = groupByEmail(customers);

  let merged = 0;
  let skipped = 0;
  for (const [email, duplicates] of Object.entries(groups)) {
    const decision = planMerge(duplicates);
    if (decision.action === "skip") {
      console.log(`Skipping ${email}: ${decision.reason}`);
      skipped++;
      continue;
    }

    const { survivor, loser } = decision;
    const preview = await previewMerge(survivor.id, loser.id);
    if (!mergePreviewIsClean(preview)) {
      console.log(`Skipping ${email}: merge preview has conflicting fields to resolve by hand`);
      skipped++;
      continue;
    }

    console.log(`Duplicate email ${email}. ${DRY_RUN ? "would merge" : "merging"} ${loser.id} into ${survivor.id}`);
    if (!DRY_RUN) await mergeCustomers(survivor.id, loser.id);
    merged++;
  }

  console.log(`Done. ${merged} group(s) ${DRY_RUN ? "to merge" : "merged"}, ${skipped} skipped.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
