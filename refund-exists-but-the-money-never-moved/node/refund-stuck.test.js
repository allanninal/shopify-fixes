import { test } from "node:test";
import assert from "node:assert/strict";
import { movedCents, isStuckRefund, toCents, hasStuckRefund } from "./find-stuck-refunds.js";

const txn = (amount, { status = "SUCCESS", kind = "REFUND" } = {}) => ({
  kind, status, amountSet: { shopMoney: { amount, currencyCode: "USD" } },
});

const refund = (total, transactions) => ({
  totalRefundedSet: { shopMoney: { amount: total, currencyCode: "USD" } },
  transactions: { nodes: transactions },
});

test("toCents rounds", () => {
  assert.equal(toCents("20.00"), 2000);
  assert.equal(toCents("9.99"), 999);
});

test("movedCents counts only SUCCESS", () => {
  const txns = [txn("20.00", { status: "SUCCESS" }), txn("20.00", { status: "FAILURE" })];
  assert.equal(movedCents({ transactions: { nodes: txns } }), 2000);
});

test("not stuck when success matches claim", () => {
  assert.equal(isStuckRefund(refund("20.00", [txn("20.00")])), false);
});

test("stuck when transaction failed", () => {
  assert.equal(isStuckRefund(refund("20.00", [txn("20.00", { status: "FAILURE" })])), true);
});

test("stuck when transaction pending", () => {
  assert.equal(isStuckRefund(refund("20.00", [txn("20.00", { status: "PENDING" })])), true);
});

test("stuck when transaction error", () => {
  assert.equal(isStuckRefund(refund("20.00", [txn("20.00", { status: "ERROR" })])), true);
});

test("stuck when no transactions at all", () => {
  assert.equal(isStuckRefund(refund("20.00", [])), true);
});

test("not stuck when partial refund ties out", () => {
  assert.equal(isStuckRefund(refund("5.00", [txn("5.00")])), false);
});

test("hasStuckRefund true when any refund is stuck", () => {
  const order = { refunds: [refund("20.00", [txn("20.00")]), refund("5.00", [txn("5.00", { status: "ERROR" })])] };
  assert.equal(hasStuckRefund(order), true);
});

test("hasStuckRefund false when all refunds ok", () => {
  const order = { refunds: [refund("20.00", [txn("20.00")])] };
  assert.equal(hasStuckRefund(order), false);
});

test("hasStuckRefund false when no refunds", () => {
  assert.equal(hasStuckRefund({ refunds: [] }), false);
});
