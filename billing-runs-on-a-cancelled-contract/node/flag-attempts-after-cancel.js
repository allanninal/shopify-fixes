/**
 * Flag Shopify orders created by a billing attempt that fired after the
 * subscription contract was already cancelled.
 *
 * Cancelling a SubscriptionContract stops future billing cycles, but a
 * billing attempt that was already queued (or that a retry re-queued) can
 * still land and create an order after the contract's status flips to
 * CANCELLED. This job walks recent subscription contracts, reads their
 * billing attempts, and tags any attempt that produced an order (or is still
 * pending) after the contract's cancelledAt timestamp with a review tag on
 * the resulting order via tagsAdd. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/billing-runs-on-a-cancelled-contract/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const REVIEW_TAG = process.env.REVIEW_TAG || "billed-after-cancel";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const CANCELLED_STATUSES = new Set(["CANCELLED", "EXPIRED"]);

/**
 * True when a billing attempt fired (or is still pending) after the
 * contract was cancelled or expired. Pure: takes plain objects, no I/O.
 */
export function attemptRanAfterCancel(contract, attempt) {
  if (!CANCELLED_STATUSES.has(contract.status)) return false;
  const cancelledAt = contract.cancelledAt;
  if (!cancelledAt) return false;
  const createdAt = attempt.createdAt;
  if (!createdAt) return false;
  if (createdAt <= cancelledAt) return false;
  return attempt.order != null || attempt.ready === false;
}

export function attemptsNeedingReview(contract) {
  const nodes = (contract.billingAttempts && contract.billingAttempts.nodes) || [];
  return nodes.filter((attempt) => attemptRanAfterCancel(contract, attempt));
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

const CONTRACTS_QUERY = `
query($cursor: String) {
  subscriptionContracts(first: 25, after: $cursor,
                         query: "status:CANCELLED OR status:EXPIRED") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id status cancelledAt
      billingAttempts(first: 20) {
        nodes {
          id createdAt ready
          order { id name tags }
        }
      }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* cancelledContracts() {
  let cursor = null;
  while (true) {
    const data = (await gql(CONTRACTS_QUERY, { cursor })).subscriptionContracts;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function tagOrderForReview(orderId, reviewTag) {
  const result = (await gql(TAGS_ADD, { id: orderId, tags: [reviewTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let flagged = 0;
  for await (const contract of cancelledContracts()) {
    for (const attempt of attemptsNeedingReview(contract)) {
      const order = attempt.order;
      if (order == null) {
        console.warn(`Contract ${contract.id} has a billing attempt ${attempt.id} still pending after cancel.`);
        continue;
      }
      if ((order.tags || []).includes(REVIEW_TAG)) continue;
      console.warn(
        `Order ${order.name} was created by attempt ${attempt.id} after contract ${contract.id} was cancelled. ${DRY_RUN ? "would tag" : "tagging"}`
      );
      if (!DRY_RUN) await tagOrderForReview(order.id, REVIEW_TAG);
      flagged++;
    }
  }
  console.log(`Done. ${flagged} order(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
