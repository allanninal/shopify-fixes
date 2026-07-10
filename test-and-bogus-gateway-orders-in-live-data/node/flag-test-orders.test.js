import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestOrder, needsTag, usesBogusGateway, toCents } from "./flag-test-orders.js";

const order = (over = {}) => ({
  test: false,
  tags: [],
  transactions: [{ gateway: "shopify_payments" }],
  currentTotalPriceSet: { shopMoney: { amount: "50.00", currencyCode: "USD" } },
  ...over,
});

test("toCents rounds", () => {
  assert.equal(toCents("50.00"), 5000);
  assert.equal(toCents("9.99"), 999);
});

test("usesBogusGateway true for bogus gateway", () => {
  assert.equal(usesBogusGateway([{ gateway: "bogus" }]), true);
});

test("usesBogusGateway is case insensitive", () => {
  assert.equal(usesBogusGateway([{ gateway: "Bogus_Gateway" }]), true);
});

test("usesBogusGateway false for a real gateway", () => {
  assert.equal(usesBogusGateway([{ gateway: "shopify_payments" }]), false);
});

test("usesBogusGateway handles missing transactions", () => {
  assert.equal(usesBogusGateway(undefined), false);
});

test("isTestOrder true when test flag is set", () => {
  assert.equal(isTestOrder(order({ test: true })), true);
});

test("isTestOrder true when bogus gateway used", () => {
  assert.equal(isTestOrder(order({ transactions: [{ gateway: "bogus" }] })), true);
});

test("isTestOrder false for a real order", () => {
  assert.equal(isTestOrder(order()), false);
});

test("needsTag true for an untagged test order", () => {
  assert.equal(needsTag(order({ test: true }), "test-order"), true);
});

test("needsTag false when already tagged", () => {
  assert.equal(needsTag(order({ test: true, tags: ["test-order"] }), "test-order"), false);
});

test("needsTag false for a live order", () => {
  assert.equal(needsTag(order(), "test-order"), false);
});
