/**
 * Tie a Shopify Payments payout to its balance transactions to the cent.
 *
 * A bank deposit is one number. The orders behind it are many. When the sum of
 * a payout's balance transactions (charges minus refunds minus fees, in other
 * words `net`) does not equal the payout's own `net` amount, either a balance
 * transaction is missing from the page you fetched, a currency got mixed in, or
 * Shopify's own numbers disagree, and finance will chase the gap by hand. This
 * script pages through recent payouts, sums the `net` of every balance
 * transaction associated with each one, and tags the payouts that do not tie
 * out for review with tagsAdd. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/reconcile-orders-against-payouts/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const PAYOUT_LOOKBACK = Number(process.env.PAYOUT_LOOKBACK || 10);
const REVIEW_TAG = process.env.REVIEW_TAG || "payout-mismatch";
const TOLERANCE_CENTS = Number(process.env.TOLERANCE_CENTS || 1);
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function toCents(amount) {
  return Math.round(parseFloat(amount) * 100);
}

export function netTransactionsCents(transactions, payoutId) {
  let total = 0;
  for (const t of transactions || []) {
    if ((t.associatedPayout || {}).id !== payoutId) continue;
    total += toCents(t.net.amount);
  }
  return total;
}

export function payoutMismatchCents(payout, transactions) {
  const payoutNet = toCents(payout.net.amount);
  const summedNet = netTransactionsCents(transactions, payout.id);
  return payoutNet - summedNet;
}

export function isMismatch(payout, transactions, toleranceCents = TOLERANCE_CENTS) {
  return Math.abs(payoutMismatchCents(payout, transactions)) > toleranceCents;
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

const PAYOUTS_QUERY = `
query($first: Int!) {
  shopifyPaymentsAccount {
    payouts(first: $first, sortKey: ISSUED_AT, reverse: true) {
      nodes {
        id
        status
        issuedAt
        net { amount currencyCode }
      }
    }
  }
}`;

const BALANCE_TRANSACTIONS_QUERY = `
query($cursor: String) {
  shopifyPaymentsAccount {
    balanceTransactions(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        associatedPayout { id }
        associatedOrder { id name }
        net { amount currencyCode }
      }
    }
  }
}`;

const TAGS_ADD = `
mutation($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
}`;

async function recentPayouts() {
  const data = (await gql(PAYOUTS_QUERY, { first: PAYOUT_LOOKBACK })).shopifyPaymentsAccount;
  return data.payouts.nodes;
}

async function allBalanceTransactions() {
  let cursor = null;
  const out = [];
  while (true) {
    const data = (await gql(BALANCE_TRANSACTIONS_QUERY, { cursor })).shopifyPaymentsAccount;
    const page = data.balanceTransactions;
    out.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return out;
    cursor = page.pageInfo.endCursor;
  }
}

async function tagForReview(payoutId, reviewTag) {
  const result = (await gql(TAGS_ADD, { id: payoutId, tags: [reviewTag] })).tagsAdd;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  const payouts = await recentPayouts();
  const transactions = await allBalanceTransactions();
  let flagged = 0;
  for (const payout of payouts) {
    const gap = payoutMismatchCents(payout, transactions);
    if (Math.abs(gap) <= TOLERANCE_CENTS) continue;
    console.warn(`Payout ${payout.id} off by ${gap} cents. ${DRY_RUN ? "would tag" : "tagging"}`);
    if (!DRY_RUN) await tagForReview(payout.id, REVIEW_TAG);
    flagged++;
  }
  console.log(`Done. ${flagged} payout(s) ${DRY_RUN ? "to tag" : "tagged"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
