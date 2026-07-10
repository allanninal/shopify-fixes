import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicateSaleTransactions } from "./find-duplicate-charges.js";

const txn = (amount, { kind = "SALE", status = "SUCCESS", id = "t" } = {}) => ({
  id, kind, status, amountSet: { shopMoney: { amount, currencyCode: "USD" } },
});

test("no duplicates when single charge", () => {
  assert.deepEqual(duplicateSaleTransactions([txn("50.00")]), []);
});

test("finds one duplicate of the same amount", () => {
  const extras = duplicateSaleTransactions([txn("50.00", { id: "a" }), txn("50.00", { id: "b" })]);
  assert.deepEqual(extras.map((t) => t.id), ["b"]);
});

test("different amounts are not duplicates", () => {
  assert.deepEqual(duplicateSaleTransactions([txn("50.00"), txn("20.00")]), []);
});

test("ignores failed and refund transactions", () => {
  const txns = [txn("50.00", { id: "a" }), txn("50.00", { status: "FAILURE", id: "b" }), txn("50.00", { kind: "REFUND", id: "c" })];
  assert.deepEqual(duplicateSaleTransactions(txns), []);
});

test("two duplicates of the same amount", () => {
  const extras = duplicateSaleTransactions([txn("9.99", { id: "a" }), txn("9.99", { id: "b" }), txn("9.99", { id: "c" })]);
  assert.deepEqual(extras.map((t) => t.id), ["b", "c"]);
});
