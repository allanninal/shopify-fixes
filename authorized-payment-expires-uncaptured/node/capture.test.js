import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleToCapture, authorizationTxn } from "./capture-authorized.js";

const order = (over = {}) => ({
  displayFinancialStatus: "AUTHORIZED",
  totalCapturableSet: { shopMoney: { amount: "50.00", currencyCode: "USD" } },
  transactions: [{ id: "gid://shopify/OrderTransaction/1", kind: "AUTHORIZATION", status: "SUCCESS" }],
  ...over,
});

test("eligible when authorized with amount and auth txn", () => {
  assert.equal(eligibleToCapture(order()), true);
});

test("skip when not authorized", () => {
  assert.equal(eligibleToCapture(order({ displayFinancialStatus: "PAID" })), false);
});

test("skip when nothing capturable", () => {
  assert.equal(eligibleToCapture(order({ totalCapturableSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } } })), false);
});

test("skip when no authorization transaction", () => {
  assert.equal(eligibleToCapture(order({ transactions: [{ id: "t", kind: "SALE", status: "SUCCESS" }] })), false);
});

test("authorizationTxn ignores failed auth", () => {
  assert.equal(authorizationTxn(order({ transactions: [{ id: "t", kind: "AUTHORIZATION", status: "FAILURE" }] })), null);
});
