import { test } from "node:test";
import assert from "node:assert/strict";
import { needsFlag, hasOpenChargeback, disputedAmountCents, toCents } from "./flag-open-chargebacks.js";

const dispute = ({ status = "NEEDS_RESPONSE", initiatedAs = "CHARGEBACK" } = {}) => ({
  id: "gid://shopify/ShopifyPaymentsDispute/1", initiatedAs, status,
});

const order = ({ financialStatus = "PAID", disputes = [dispute()], tags = [], received = "50.00" } = {}) => ({
  displayFinancialStatus: financialStatus,
  disputes,
  tags,
  totalReceivedSet: { shopMoney: { amount: received, currencyCode: "USD" } },
});

test("toCents rounds", () => {
  assert.equal(toCents("50.00"), 5000);
  assert.equal(toCents("9.99"), 999);
});

test("hasOpenChargeback true for needs_response", () => {
  assert.equal(hasOpenChargeback(order()), true);
});

test("hasOpenChargeback true for under_review", () => {
  assert.equal(hasOpenChargeback(order({ disputes: [dispute({ status: "UNDER_REVIEW" })] })), true);
});

test("hasOpenChargeback false when won", () => {
  assert.equal(hasOpenChargeback(order({ disputes: [dispute({ status: "WON" })] })), false);
});

test("hasOpenChargeback false for inquiry only", () => {
  assert.equal(hasOpenChargeback(order({ disputes: [dispute({ initiatedAs: "INQUIRY" })] })), false);
});

test("needsFlag true when paid, disputed, and untagged", () => {
  assert.equal(needsFlag(order(), "chargeback-open"), true);
});

test("needsFlag true when partially refunded", () => {
  assert.equal(needsFlag(order({ financialStatus: "PARTIALLY_REFUNDED" }), "chargeback-open"), true);
});

test("needsFlag false when no disputes", () => {
  assert.equal(needsFlag(order({ disputes: [] }), "chargeback-open"), false);
});

test("needsFlag false when dispute resolved", () => {
  assert.equal(needsFlag(order({ disputes: [dispute({ status: "WON" })] }), "chargeback-open"), false);
});

test("needsFlag false when already tagged", () => {
  assert.equal(needsFlag(order({ tags: ["chargeback-open"] }), "chargeback-open"), false);
});

test("needsFlag false when financial status not relevant", () => {
  assert.equal(needsFlag(order({ financialStatus: "REFUNDED" }), "chargeback-open"), false);
});

test("disputedAmountCents reads shop money", () => {
  assert.equal(disputedAmountCents(order({ received: "123.45" })), 12345);
});
