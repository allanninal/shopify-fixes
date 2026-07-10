/**
 * Detect and recreate Shopify webhook subscriptions that Shopify auto-deleted.
 *
 * Shopify removes a webhook subscription on its own after delivery keeps
 * failing, for example your endpoint was down for days or kept returning
 * errors. The app never hears about the removal. It just quietly stops
 * receiving that topic, and the gap is invisible until someone notices an
 * order or a fulfillment never triggered the expected side effect.
 *
 * This job compares the webhook subscriptions you require (topic and endpoint
 * uri) against what Shopify actually has registered with webhookSubscriptions,
 * and recreates the ones that are missing with webhookSubscriptionCreate. It
 * never deletes or edits a subscription that already exists, it only fills
 * gaps. Run on a schedule. Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/webhook-subscription-auto-deleted/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

// A JSON array of {"topic": "...", "uri": "..."} pairs your app depends on.
// Example: [{"topic":"ORDERS_PAID","uri":"https://app.example.com/webhooks/orders-paid"}]
const REQUIRED_WEBHOOKS = JSON.parse(process.env.REQUIRED_WEBHOOKS || "[]");

const SUBSCRIPTIONS_QUERY = `
query($cursor: String) {
  webhookSubscriptions(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id topic uri format createdAt }
  }
}`;

const CREATE_MUTATION = `
mutation($topic: WebhookSubscriptionTopic!, $uri: String!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;

/**
 * Pure decision function. No I/O.
 *
 * existing: array of {topic, uri, ...} read from Shopify.
 * required: array of {topic, uri}, the app's declared needs.
 * Returns the entries from required that have no matching existing
 * subscription on the same topic and uri. Topic comparison is
 * case-insensitive since Shopify always returns the enum in upper snake case.
 */
export function missingSubscriptions(existing, required) {
  const livePairs = new Set(
    existing.map((item) => `${(item.topic || "").toUpperCase()}::${item.uri}`)
  );
  return required.filter((need) => {
    const key = `${(need.topic || "").toUpperCase()}::${need.uri}`;
    return !livePairs.has(key);
  });
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

async function* existingSubscriptions() {
  let cursor = null;
  while (true) {
    const data = (await gql(SUBSCRIPTIONS_QUERY, { cursor })).webhookSubscriptions;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function createSubscription(topic, uri) {
  const result = (await gql(CREATE_MUTATION, { topic, uri })).webhookSubscriptionCreate;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.webhookSubscription;
}

export async function run() {
  if (!REQUIRED_WEBHOOKS.length) {
    console.warn("REQUIRED_WEBHOOKS is empty. Nothing to check. Set it to a JSON list of {topic, uri}.");
    return;
  }

  const current = [];
  for await (const node of existingSubscriptions()) current.push(node);
  const gaps = missingSubscriptions(current, REQUIRED_WEBHOOKS);

  for (const gap of gaps) {
    console.warn(`Missing webhook subscription for ${gap.topic} at ${gap.uri}. ${DRY_RUN ? "would recreate" : "recreating"}`);
    if (!DRY_RUN) await createSubscription(gap.topic, gap.uri);
  }

  console.log(`Done. ${gaps.length} subscription(s) ${DRY_RUN ? "to recreate" : "recreated"} out of ${REQUIRED_WEBHOOKS.length} required.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
