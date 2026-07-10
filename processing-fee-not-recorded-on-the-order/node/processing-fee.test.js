import { test } from "node:test";
import assert from "node:assert/strict";
import { feeCentsForOrder, toCents } from "./record-processing-fee.js";

const fee = (amount) => ({ amount: { amount, currencyCode: "USD" } });
const txn = (fees, { kind = "SALE", status = "SUCCESS" } = {}) => ({ kind, status, fees });
const order = (transactions, existingValue = null) => ({
  feeMetafield: existingValue !== null ? { value: existingValue } : null,
  transactions,
});

test("toCents rounds", () => {
  assert.equal(toCents("1.49"), 149);
});

test("sums fee on successful sale", () => {
  assert.equal(feeCentsForOrder(order([txn([fee("1.50")])])), 150);
});

test("sums fees across capture and sale", () => {
  const o = order([txn([fee("1.00")], { kind: "SALE" }), txn([fee("0.50")], { kind: "CAPTURE" })]);
  assert.equal(feeCentsForOrder(o), 150);
});

test("ignores failed transactions", () => {
  const o = order([txn([fee("1.50")], { status: "FAILURE" })]);
  assert.equal(feeCentsForOrder(o), null);
});

test("ignores refund transactions", () => {
  const o = order([txn([fee("1.50")], { kind: "REFUND" })]);
  assert.equal(feeCentsForOrder(o), null);
});

test("skips when already recorded", () => {
  const o = order([txn([fee("1.50")])], "150");
  assert.equal(feeCentsForOrder(o), null);
});

test("null when no fee present", () => {
  const o = order([txn([])]);
  assert.equal(feeCentsForOrder(o), null);
});

test("multiple fees on one transaction", () => {
  const o = order([txn([fee("1.00"), fee("0.30")])]);
  assert.equal(feeCentsForOrder(o), 130);
});
