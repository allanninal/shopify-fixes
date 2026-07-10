/**
 * Find active Shopify subscription contracts that have no valid payment method.
 *
 * A contract can end up with lastPaymentStatus of NO_PAYMENT_METHOD when the
 * customer's card was removed, the vault entry was revoked by the customer's
 * bank, or the contract was created without one attached. Shopify will keep
 * trying to bill on schedule and keep failing silently unless someone notices.
 * This job pages through active contracts, applies a pure decision function to
 * flag the ones that cannot bill, and tags them for review with tagsAdd so a
 * human can email the buyer for a new card. It never touches billing or money
 * itself. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/contract-has-no-valid-payment-method/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const REVIEW_TAG = process.env.REVIEW_TAG || "needs-payment-method";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const ACTIVE_STATUSES = new Set(["ACTIVE"]);
const NO_METHOD_PAYMENT_STATUSES = new Set(["NO_PAYMENT_METHOD", "PENDING_SETTING_UP_PAYMENT_METHOD"]);

/**
 * True when an active contract cannot bill because it has no usable payment method.
 *
 * A contract cannot bill when any of these hold:
 * - Shopify's own lastPaymentStatus already says there is no payment method
 * - the payment method was revoked (the bank or the customer pulled it)
 * - the contract has no payment method attached at all
 * Cancelled, paused, or already-flagged contracts are left alone.
 */
export function hasNoValidPaymentMethod(contract) {
  if (!ACTIVE_STATUSES.has(contract.status)) return false;
  const method = contract.customerPaymentMethod;
  if (NO_METHOD_PAYMENT_STATUSES.has(contract.lastPaymentStatus)) return true;
  if (!method) return true;
  if (method.revokedAt) return true;
  return false;
}

export function needsTag(contract, reviewTag) {
  if (!hasNoValidPaymentMethod(contract)) return false;
  return !(contract.tags || []).includes(reviewTag);
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
  subscriptionContracts(first: 50, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      status
      lastPaymentStatus
      customer { id email }
      customerPaymentMethod { id revokedAt instrument { __typename } }
      currentPeriodEnd
      tags
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* activeContracts() {
  let cursor = null;
  while (true) {
    const data = (await gql(CONTRACTS_QUERY, { cursor })).subscriptionContracts;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function tagForReview(contractId, reviewTag) {
  const result = (await gql(TAGS_ADD, { id: contractId, tags: [reviewTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let flagged = 0;
  for await (const contract of activeContracts()) {
    if (!needsTag(contract, REVIEW_TAG)) continue;
    const email = contract.customer?.email || "unknown";
    console.warn(`Contract ${contract.id} (${email}) has no valid payment method. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagForReview(contract.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} contract(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
