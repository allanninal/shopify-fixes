import { test } from "node:test";
import assert from "node:assert/strict";
import { netCapturedCents, isMismatch, toCents } from "./find-ledger-mismatch.js";

const txn = (amount, { kind = "SALE", status = "SUCCESS" } = {}) => ({
  kind, status, amountSet: { shopMoney: { amount, currencyCode: "USD" } },
});

const order = (received, transactions, tags = []) => ({
  totalReceivedSet: { shopMoney: { amount: received, currencyCode: "USD" } },
  transactions,
  tags,
});

test("toCents rounds", () => {
  assert.equal(toCents("50.00"), 5000);
  assert.equal(toCents("9.99"), 999);
});

test("netCaptured sums charges", () => {
  assert.equal(netCapturedCents([txn("50.00"), txn("20.00", { kind: "CAPTURE" })]), 7000);
});

test("netCaptured subtracts refunds", () => {
  assert.equal(netCapturedCents([txn("50.00"), txn("10.00", { kind: "REFUND" })]), 4000);
});

test("netCaptured ignores failed", () => {
  assert.equal(netCapturedCents([txn("50.00"), txn("50.00", { status: "FAILURE" })]), 5000);
});

test("no mismatch when balanced", () => {
  assert.equal(isMismatch(order("40.00", [txn("50.00"), txn("10.00", { kind: "REFUND" })])), false);
});

test("mismatch when refund not reflected", () => {
  assert.equal(isMismatch(order("50.00", [txn("50.00"), txn("10.00", { kind: "REFUND" })])), true);
});

test("mismatch when capture missing", () => {
  assert.equal(isMismatch(order("50.00", [])), true);
});
