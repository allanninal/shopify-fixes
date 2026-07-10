/**
 * Realign a Shopify subscription contract's nextBillingDate when it drifts
 * from the date the billing policy actually implies.
 *
 * The stored nextBillingDate on a SubscriptionContract should always be the
 * origin date plus a whole number of intervals (for example every 30 days,
 * or every 1 month). A paused-then-resumed contract, a manually edited date,
 * or a missed billing cycle can leave nextBillingDate sitting on a date the
 * policy never produces. This walks each active contract, recomputes the
 * date the policy implies, and calls subscriptionContractSetNextBillingDate
 * to move the next cycle back onto schedule when it drifts past a small
 * tolerance. Read only apart from the one write. Run on a schedule.
 * Safe to run again and again.
 *
 * Guide: https://www.allanninal.dev/shopify/next-billing-date-drifts/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const DRIFT_TOLERANCE_DAYS = Number(process.env.DRIFT_TOLERANCE_DAYS || 1);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

const ACTIVE_STATUSES = new Set(["ACTIVE"]);

// Shopify's billingPolicy.interval values.
const DAY_LENGTHS = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(value) {
  // Accept a date or datetime string, keep only the calendar date, in UTC.
  const text = value.slice(0, 10);
  const [y, m, d] = text.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIsoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Walk forward from the origin in whole intervals and return the first
 * cycle date (as epoch ms, UTC midnight) that is on or after today.
 * Pure: no I/O, no Date.now() lookups.
 */
export function expectedNextBillingDateMs(originMs, interval, intervalCount, todayMs) {
  const stepDays = DAY_LENGTHS[interval];
  if (!stepDays || !intervalCount || intervalCount <= 0) return null;
  const spanMs = stepDays * intervalCount * MS_PER_DAY;
  if (todayMs <= originMs) return originMs;
  const elapsed = todayMs - originMs;
  const cyclesPassed = Math.floor(elapsed / spanMs);
  let candidateMs = originMs + cyclesPassed * spanMs;
  if (candidateMs < todayMs) candidateMs += spanMs;
  return candidateMs;
}

/**
 * Pure decision function. Given a contract object and a reference "today"
 * (epoch ms, UTC midnight), return the ISO date string to write, or null
 * if nothing needs to change.
 */
export function decideRealignment(contract, todayMs) {
  if (!ACTIVE_STATUSES.has(contract.status)) return null;

  const policy = contract.billingPolicy || {};
  const { interval, intervalCount } = policy;
  if (!interval || !intervalCount) return null;

  const storedRaw = contract.nextBillingDate;
  const originRaw = contract.createdAt;
  if (!storedRaw || !originRaw) return null;

  const storedMs = parseDateOnly(storedRaw);
  const originMs = parseDateOnly(originRaw);

  const expectedMs = expectedNextBillingDateMs(originMs, interval, intervalCount, todayMs);
  if (expectedMs === null) return null;

  const driftDays = Math.abs(storedMs - expectedMs) / MS_PER_DAY;
  if (driftDays <= DRIFT_TOLERANCE_DAYS) return null;

  return toIsoDate(expectedMs);
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
  subscriptionContracts(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      status
      nextBillingDate
      createdAt
      billingPolicy { interval intervalCount }
    }
  }
}`;

const SET_NEXT_BILLING_DATE = `
mutation($contractId: ID!, $date: DateTime!) {
  subscriptionContractSetNextBillingDate(contractId: $contractId, date: $date) {
    contract { id nextBillingDate }
    userErrors { field message }
  }
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

async function setNextBillingDate(contractId, isoDate) {
  const result = (
    await gql(SET_NEXT_BILLING_DATE, { contractId, date: isoDate })
  ).subscriptionContractSetNextBillingDate;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
  return result.contract.nextBillingDate;
}

export async function run() {
  const todayMs = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  );
  let fixed = 0;
  for await (const contract of activeContracts()) {
    const target = decideRealignment(contract, todayMs);
    if (target === null) continue;
    console.log(
      `Contract ${contract.id} drifted. stored=${contract.nextBillingDate} expected=${target}. ${
        DRY_RUN ? "would realign" : "realigning"
      }`
    );
    if (!DRY_RUN) await setNextBillingDate(contract.id, target);
    fixed++;
  }
  console.log(`Done. ${fixed} contract(s) ${DRY_RUN ? "to realign" : "realigned"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
