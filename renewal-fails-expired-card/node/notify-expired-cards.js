/**
 * Email subscribers whose saved card is expired or revoked, before the renewal fails.
 *
 * A subscription renewal fails when the card on the contract has expired or the payment
 * method was revoked. Instead of waiting for the failed billing attempt, this walks the
 * active contracts, finds the ones whose card is expired or whose method is gone, and
 * sends the built-in email with customerPaymentMethodSendUpdateEmail. Run on a schedule.
 *
 * Guide: https://www.allanninal.dev/shopify/renewal-fails-expired-card/
 */
import { pathToFileURL } from "node:url";

const SHOP = process.env.SHOPIFY_SHOP || "example.myshopify.com";
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || "shpat_dummy";
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";
const ENDPOINT = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
const DRY_RUN = (process.env.DRY_RUN || "true").toLowerCase() === "true";

export function cardExpired(month, year, nowYear, nowMonth) {
  if (month == null || year == null) return false;
  return year < nowYear || (year === nowYear && month < nowMonth);
}

export function needsUpdate(contract, nowYear, nowMonth) {
  if (contract.status !== "ACTIVE") return false;
  const pm = contract.customerPaymentMethod;
  if (!pm) return false;
  if (pm.revokedAt) return true;
  const card = pm.instrument || {};
  return cardExpired(card.expiryMonth, card.expiryYear, nowYear, nowMonth);
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
      id status
      customerPaymentMethod {
        id revokedAt
        instrument { ... on CustomerCreditCard { expiryMonth expiryYear } }
      }
    }
  }
}`;

const SEND_EMAIL = `
mutation($id: ID!) {
  customerPaymentMethodSendUpdateEmail(customerPaymentMethodId: $id) {
    customer { id }
    userErrors { field message }
  }
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

async function sendUpdateEmail(paymentMethodId) {
  const result = (await gql(SEND_EMAIL, { id: paymentMethodId })).customerPaymentMethodSendUpdateEmail;
  if (result.userErrors.length) throw new Error(JSON.stringify(result.userErrors));
}

export async function run() {
  const now = new Date();
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  let notified = 0;
  const seen = new Set();
  for await (const contract of contracts()) {
    if (!needsUpdate(contract, nowYear, nowMonth)) continue;
    const pmId = contract.customerPaymentMethod.id;
    if (seen.has(pmId)) continue;
    seen.add(pmId);
    console.warn(`Contract ${contract.id} has an expired or revoked card. ${DRY_RUN ? "would email" : "emailing"}`);
    if (!DRY_RUN) await sendUpdateEmail(pmId);
    notified++;
  }
  console.log(`Done. ${notified} customer(s) ${DRY_RUN ? "to email" : "emailed"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
