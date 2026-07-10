/**
 * Rebuild a Shopify selling plan group an uninstalled app took with it.
 *
 * When a subscriptions app owns a SellingPlanGroup and the merchant uninstalls
 * that app, Shopify deletes every selling plan group the app owns. The product
 * survives, but productVariants().sellingPlanGroupsCount drops to zero, so the
 * subscribe and save option silently disappears from checkout. This scans
 * products that are supposed to be subscribable (tagged), finds the ones that
 * lost their selling plan group, recreates a merchant-owned replacement with an
 * equivalent policy, and reattaches it with sellingPlanGroupAddProducts. Safe
 * to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/selling-plan-deleted-after-app-uninstall/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const SUBSCRIBABLE_TAG = process.env.SUBSCRIBABLE_TAG || "subscribe-and-save";
const PLAN_NAME = process.env.PLAN_NAME || "Subscribe and save";
const DISCOUNT_PERCENT = Number(process.env.DISCOUNT_PERCENT || 10);
const DELIVERY_INTERVAL = process.env.DELIVERY_INTERVAL || "MONTH";
const DELIVERY_INTERVAL_COUNT = Number(process.env.DELIVERY_INTERVAL_COUNT || 1);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

/**
 * Pure decision: does this product need its selling plan group rebuilt?
 *
 * True only when the product carries the confirmation tag (it was meant to
 * be subscribable) and its current selling plan group count is zero, which
 * is what an app-uninstall deletion leaves behind.
 */
export function needsSellingPlan(product, requiredTag) {
  if (!(product.tags || []).includes(requiredTag)) return false;
  const count = product.sellingPlanGroupsCount?.count ?? 0;
  return count === 0;
}

/**
 * Compute the discounted price in minor units (cents) for a given percent off.
 * Kept as integer math throughout so the result never suffers floating point drift.
 */
export function discountMinorUnits(priceCents, percent) {
  return Math.round((priceCents * (100 - percent)) / 100);
}

/**
 * Build the SellingPlanGroupInput payload for a simple recurring discount plan.
 * Pure builder, no I/O, so the shape is trivial to unit test.
 */
export function sellingPlanGroupInput(name, percent, interval, intervalCount) {
  return {
    name,
    merchantCode: name.toLowerCase().replace(/\s+/g, "-"),
    options: ["Delivery frequency"],
    sellingPlansToCreate: [
      {
        name: `Delivered every ${intervalCount} ${interval.toLowerCase()}(s)`,
        options: [`Every ${intervalCount} ${interval.toLowerCase()}(s)`],
        billingPolicy: { recurring: { interval, intervalCount } },
        deliveryPolicy: { recurring: { interval, intervalCount } },
        pricingPolicies: [
          {
            fixed: {
              adjustmentType: "PERCENTAGE",
              adjustmentValue: { percentage: percent },
            },
          },
        ],
      },
    ],
  };
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

const PRODUCTS_QUERY = `
query($cursor: String, $q: String!) {
  products(first: 25, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title tags
      sellingPlanGroupsCount { count }
      variants(first: 1) { nodes { id } }
    }
  }
}`;

const GROUP_CREATE = `
mutation($input: SellingPlanGroupInput!) {
  sellingPlanGroupCreate(input: $input) {
    sellingPlanGroup { id name }
    userErrors { field message }
  }
}`;

const GROUP_ADD_PRODUCTS = `
mutation($id: ID!, $productIds: [ID!]!) {
  sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
    userErrors { field message }
  }
}`;

async function* subscribableProducts() {
  const q = `tag:${SUBSCRIBABLE_TAG}`;
  let cursor = null;
  while (true) {
    const data = (await gql(PRODUCTS_QUERY, { cursor, q })).products;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function createGroup(name, percent, interval, intervalCount) {
  const payload = sellingPlanGroupInput(name, percent, interval, intervalCount);
  const result = (await gql(GROUP_CREATE, { input: payload })).sellingPlanGroupCreate;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.sellingPlanGroup.id;
}

async function attachGroup(groupId, productIds) {
  const result = (await gql(GROUP_ADD_PRODUCTS, { id: groupId, productIds })).sellingPlanGroupAddProducts;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  const broken = [];
  for await (const product of subscribableProducts()) {
    if (needsSellingPlan(product, SUBSCRIBABLE_TAG)) broken.push(product);
  }

  if (broken.length === 0) {
    console.log("Done. 0 product(s) needed a rebuilt selling plan group.");
    return;
  }

  console.log(
    `${broken.length} product(s) lost their selling plan group. ${DRY_RUN ? "would rebuild" : "rebuilding"}`
  );
  for (const product of broken) console.log(`  - ${product.title} (${product.id})`);

  if (DRY_RUN) {
    console.log(`Done. ${broken.length} product(s) to rebuild.`);
    return;
  }

  const groupId = await createGroup(PLAN_NAME, DISCOUNT_PERCENT, DELIVERY_INTERVAL, DELIVERY_INTERVAL_COUNT);
  await attachGroup(groupId, broken.map((p) => p.id));
  console.log(`Done. ${broken.length} product(s) reattached to ${groupId}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
