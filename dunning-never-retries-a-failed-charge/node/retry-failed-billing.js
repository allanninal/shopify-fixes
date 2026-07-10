/**
 * Retry Shopify subscription billing attempts that failed, on a safe backoff.
 *
 * A recurring charge can fail for many ordinary reasons: an expired card, a bank
 * that declined the charge, a payment gateway timeout. Shopify records the failure
 * on the SubscriptionContract as lastPaymentStatus FAILED, but nothing retries it
 * on its own. This job finds active contracts whose last payment failed, looks at
 * the contract's own billingAttempts history to work out how long it has been
 * failing, and creates a new billing attempt once the right number of days have
 * passed, following a backoff schedule so we do not hammer a card that just failed.
 * Read the billing history, decide with a pure function, then only write
 * (subscriptionBillingAttemptCreate) when it is due. Run on a schedule, for
 * example daily.
 *
 * Guide: https://www.allanninal.dev/shopify/dunning-never-retries-a-failed-charge/
 */
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

// Days to wait after the most recent attempt before trying again. The index in
// this array is the retry number: the 1st retry waits 1 day, the 2nd waits 3
// days, the 3rd waits 7 days. After that we stop retrying automatically.
const BACKOFF_SCHEDULE_DAYS = [1, 3, 7];
const MAX_RETRIES = BACKOFF_SCHEDULE_DAYS.length;

export function failedAttemptCount(billingAttempts) {
  let count = 0;
  for (const attempt of billingAttempts || []) {
    if (attempt.completedAt) break;
    count += 1;
  }
  return count;
}

function daysBetween(earlierIso, laterIso) {
  const earlier = new Date(earlierIso).getTime();
  const later = new Date(laterIso).getTime();
  return (later - earlier) / 86400000;
}

/**
 * Pure decision: should we fire another billing attempt for this contract, right now?
 *
 * Rules, in order:
 *   1. Only contracts whose lastPaymentStatus is FAILED are candidates.
 *   2. We count the unbroken run of failed attempts from most recent backwards
 *      (billingAttempts must already be ordered most recent first). If that
 *      count is at or beyond MAX_RETRIES, we stop retrying automatically.
 *   3. We look at how many whole days have passed since the most recent
 *      attempt, and compare that against the schedule entry for this retry
 *      number. If not enough days have passed, it is not due yet.
 *   4. If there is no billing attempt history at all, there is nothing to
 *      retry against, so we skip.
 *
 * No I/O happens in this function, so it is fully unit testable.
 */
export function retryDecision(contract, nowIso) {
  if (contract.lastPaymentStatus !== "FAILED") return false;

  const attempts = contract.billingAttempts || [];
  const failedCount = failedAttemptCount(attempts);
  if (failedCount === 0 || failedCount > MAX_RETRIES) return false;

  const lastAttempt = attempts[0];
  const lastCreatedAt = lastAttempt && lastAttempt.createdAt;
  if (!lastCreatedAt) return false;

  const waitDays = BACKOFF_SCHEDULE_DAYS[failedCount - 1];
  const elapsedDays = daysBetween(lastCreatedAt, nowIso);
  return elapsedDays >= waitDays;
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
  subscriptionContracts(first: 25, after: $cursor, query: "status:ACTIVE") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      lastPaymentStatus
      customer { defaultEmailAddress { emailAddress } }
      billingAttempts(first: 10, reverse: true) {
        nodes { id createdAt completedAt }
      }
    }
  }
}`;

const RETRY_MUTATION = `
mutation($contractId: ID!, $idempotencyKey: String!) {
  subscriptionBillingAttemptCreate(
    subscriptionContractId: $contractId
    subscriptionBillingAttemptInput: { idempotencyKey: $idempotencyKey }
  ) {
    subscriptionBillingAttempt { id }
    userErrors { field message }
  }
}`;

async function* failedContracts() {
  let cursor = null;
  while (true) {
    const data = (await gql(CONTRACTS_QUERY, { cursor })).subscriptionContracts;
    for (const node of data.nodes) yield node;
    if (!data.pageInfo.hasNextPage) return;
    cursor = data.pageInfo.endCursor;
  }
}

async function retryBilling(contractId, idempotencyKey) {
  const result = (await gql(RETRY_MUTATION, { contractId, idempotencyKey })).subscriptionBillingAttemptCreate;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.subscriptionBillingAttempt.id;
}

export async function run() {
  const nowIso = new Date().toISOString();
  let retried = 0;
  for await (const contract of failedContracts()) {
    if (!retryDecision(contract, nowIso)) continue;
    const idempotencyKey = `dunning-retry-${contract.id.split("/").pop()}-${randomUUID().slice(0, 8)}`;
    console.log(`Contract ${contract.id} is due for a retry. ${DRY_RUN ? "would retry" : "retrying"}`);
    if (!DRY_RUN) await retryBilling(contract.id, idempotencyKey);
    retried++;
  }
  console.log(`Done. ${retried} contract(s) ${DRY_RUN ? "to retry" : "retried"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
