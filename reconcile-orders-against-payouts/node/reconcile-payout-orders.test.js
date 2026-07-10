import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toCents,
  netTransactionsCents,
  payoutMismatchCents,
  isMismatch,
} from "./reconcile-payout-orders.js";

const payout = (net, payoutId = "gid://shopify/ShopifyPaymentsPayout/1") => ({
  id: payoutId, status: "PAID", net: { amount: net, currencyCode: "USD" },
});

const txn = (net, { payoutId = "gid://shopify/ShopifyPaymentsPayout/1", orderName = "#1001" } = {}) => ({
  associatedPayout: { id: payoutId },
  associatedOrder: { id: "gid://shopify/Order/1", name: orderName },
  net: { amount: net, currencyCode: "USD" },
});

test("toCents rounds", () => {
  assert.equal(toCents("50.00"), 5000);
  assert.equal(toCents("9.99"), 999);
});

test("netTransactionsCents sums only matching payout", () => {
  const transactions = [txn("40.00"), txn("10.00"), txn("5.00", { payoutId: "other" })];
  assert.equal(netTransactionsCents(transactions, "gid://shopify/ShopifyPaymentsPayout/1"), 5000);
});

test("no mismatch when balanced", () => {
  const p = payout("50.00");
  const transactions = [txn("30.00"), txn("20.00")];
  assert.equal(payoutMismatchCents(p, transactions), 0);
  assert.equal(isMismatch(p, transactions), false);
});

test("mismatch when transaction missing", () => {
  const p = payout("50.00");
  const transactions = [txn("30.00")];
  assert.equal(payoutMismatchCents(p, transactions), 2000);
  assert.equal(isMismatch(p, transactions), true);
});

test("mismatch when transactions overshoot", () => {
  const p = payout("50.00");
  const transactions = [txn("30.00"), txn("30.00")];
  assert.equal(payoutMismatchCents(p, transactions), -1000);
  assert.equal(isMismatch(p, transactions), true);
});

test("within tolerance is not a mismatch", () => {
  const p = payout("50.00");
  const transactions = [txn("49.99")];
  assert.equal(isMismatch(p, transactions), false);
});

test("transactions from other payouts are ignored", () => {
  const p = payout("50.00");
  const transactions = [txn("50.00"), txn("999.00", { payoutId: "gid://shopify/ShopifyPaymentsPayout/2" })];
  assert.equal(isMismatch(p, transactions), false);
});
