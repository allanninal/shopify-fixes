/**
 * Verify Shopify webhook HMAC signatures against the raw request body, not the parsed one.
 *
 * The Admin webhook HMAC is computed over the exact bytes Shopify sent. If a framework,
 * a logging middleware, or your own handler parses the JSON body first and later
 * recomputes the signature from JSON.stringify(parsedBody), the bytes drift, so every
 * single webhook fails verification even though nothing is actually wrong. This module
 * exports the pure verification function (no I/O, safe to unit test) plus a small audit
 * job that pages through webhookSubscriptions on the Admin GraphQL API and flags any
 * subscription whose delivery format is not JSON, since that is the other common cause
 * of "the signature never matches." Run the audit on a schedule. Safe to run again and
 * again, it only reads and, when DRY_RUN is off, switches the format to JSON.
 *
 * Guide: https://www.allanninal.dev/shopify/webhook-hmac-check-keeps-failing/
 */
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || "";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

/**
 * Pure. Returns the base64-encoded HMAC-SHA256 of the raw request bytes.
 * rawBody must be the exact bytes (Buffer or string) Shopify posted, before any JSON parsing.
 */
export function computeHmac(rawBody, secret) {
  const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  return crypto.createHmac("sha256", secret).update(bodyBuffer).digest("base64");
}

/**
 * Pure decision function. No I/O, no dependency on Express/Fastify request objects.
 *
 * rawBody: the exact bytes (or string) of the request body, read before parsing.
 * headerHmac: the value of the X-Shopify-Hmac-Sha256 header, base64 text.
 * secret: the app's client secret.
 * Returns true only when the computed digest matches the header byte for byte,
 * compared in constant time so timing does not leak information about the secret.
 */
export function verifyHmac(rawBody, headerHmac, secret) {
  if (!headerHmac) return false;
  const expected = computeHmac(rawBody, secret);
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(headerHmac, "utf8");
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

/**
 * Pure decision function. No I/O.
 *
 * subscriptions: list of objects with at least "format", as returned by Shopify.
 * A webhook registered with format XML changes the byte layout of the body but not
 * how most starter code recomputes the signature, which is a second, unrelated way
 * teams end up chasing a false HMAC mismatch. Returns the subset that is not JSON.
 */
export function misconfiguredSubscriptions(subscriptions) {
  return subscriptions.filter((s) => (s.format || "").toUpperCase() !== "JSON");
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

const SUBSCRIPTIONS_QUERY = `
query($cursor: String) {
  webhookSubscriptions(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id topic uri format }
  }
}`;

const UPDATE_MUTATION = `
mutation($id: ID!, $uri: String!) {
  webhookSubscriptionUpdate(id: $id, webhookSubscription: { uri: $uri, format: JSON }) {
    webhookSubscription { id topic uri format }
    userErrors { field message }
  }
}`;

async function* allSubscriptions() {
  let cursor = null;
  while (true) {
    const data = (await gql(SUBSCRIPTIONS_QUERY, { cursor })).webhookSubscriptions;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function switchToJson(subscriptionId, uri) {
  const result = (await gql(UPDATE_MUTATION, { id: subscriptionId, uri })).webhookSubscriptionUpdate;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.webhookSubscription.format;
}

export async function run() {
  const subs = [];
  for await (const sub of allSubscriptions()) subs.push(sub);
  const bad = misconfiguredSubscriptions(subs);

  for (const sub of bad) {
    console.warn(
      `Webhook ${sub.topic} at ${sub.uri} uses format ${sub.format}, not JSON. ${DRY_RUN ? "would switch to JSON" : "switching to JSON"}`
    );
    if (!DRY_RUN) await switchToJson(sub.id, sub.uri);
  }

  console.log(`Done. ${bad.length} of ${subs.length} webhook subscription(s) ${DRY_RUN ? "to fix" : "switched to JSON"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
