/**
 * Find subscription renewals that got billed twice for the same cycle.
 *
 * A retry after a timeout or a webhook redelivered without an idempotency key
 * can create a second successful billing attempt for a contract that already
 * has one for the same cycle. Each attempt makes its own order and charges the
 * card again, so the customer pays twice for one box. This walks each active
 * subscription contract's recent billing attempts, groups them by billing
 * cycle (the anniversary date Shopify records on the attempt), flags every
 * successful attempt after the first one in a cycle as a duplicate, and tags
 * the extra order for a refund review with tagsAdd. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/duplicate-renewal-charges/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const REVIEW_TAG = process.env.REVIEW_TAG || "duplicate-renewal";
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function billingCycleKey(attempt) {
  // originTime is the anniversary date Shopify assigns to the attempt, so two
  // attempts for the same renewal share the same day even if one was a retry
  // made minutes or hours after the first.
  const origin = attempt.originTime || "";
  return origin.slice(0, 10);
}

function successfulAttempts(attempts) {
  // Only attempts that produced a real order are charges worth counting.
  return (attempts || []).filter((a) => a.order != null);
}

/**
 * Pure decision function. No I/O.
 *
 * Groups a contract's successful billing attempts by cycle. Within a cycle,
 * the first attempt (attempts must be passed oldest first) is the legitimate
 * charge and every attempt after it is a duplicate. Returns the order id,
 * name, and amount in cents for each duplicate that is not already tagged,
 * never the original charge.
 */
export function findDuplicateOrders(contract, reviewTag) {
  const attempts = successfulAttempts(contract.billingAttempts);
  const seenCycles = new Set();
  const duplicates = [];
  for (const attempt of attempts) {
    const cycle = billingCycleKey(attempt);
    const order = attempt.order;
    if (!seenCycles.has(cycle)) {
      seenCycles.add(cycle);
      continue;
    }
    if ((order.tags || []).includes(reviewTag)) continue;
    const amount = toCents(order.totalPriceSet.shopMoney.amount);
    duplicates.push({ orderId: order.id, name: order.name, amountCents: amount });
  }
  return duplicates;
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
  subscriptionContracts(first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      billingAttempts(first: 20, reverse: true) {
        nodes {
          id
          ready
          idempotencyKey
          originTime
          order {
            id
            name
            tags
            totalPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function* contracts() {
  let cursor = null;
  while (true) {
    const data = (await gql(CONTRACTS_QUERY, { cursor })).subscriptionContracts;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function tagForReview(orderId, reviewTag) {
  const result = (await gql(TAGS_ADD, { id: orderId, tags: [reviewTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  let flagged = 0;
  for await (const contract of contracts()) {
    // billingAttempts comes back newest first, flip it so the earliest
    // attempt in a cycle is treated as the original charge.
    const attempts = [...(contract.billingAttempts?.nodes || [])].reverse();
    const orderedContract = { ...contract, billingAttempts: attempts };
    for (const dup of findDuplicateOrders(orderedContract, REVIEW_TAG)) {
      console.warn(
        `Order ${dup.name} is a duplicate renewal charge (${dup.amountCents} cents). ${DRY_RUN ? "would tag" : "tagging"}`
      );
      if (!DRY_RUN) await tagForReview(dup.orderId, REVIEW_TAG);
      flagged++;
    }
  }
  console.log(`Done. ${flagged} order(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
