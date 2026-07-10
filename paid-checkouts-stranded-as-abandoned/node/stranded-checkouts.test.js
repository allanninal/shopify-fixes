import { test } from "node:test";
import assert from "node:assert/strict";
import { isStranded, toCents, checkoutTokenFromGid } from "./find-stranded-checkouts.js";

const checkout = (over = {}) => ({
  id: "gid://shopify/AbandonedCheckout/123",
  completedAt: "2026-07-09T10:00:00Z",
  totalPriceSet: { shopMoney: { amount: "49.99", currencyCode: "USD" } },
  ...over,
});

test("toCents rounds", () => {
  assert.equal(toCents("49.99"), 4999);
  assert.equal(toCents("10.00"), 1000);
});

test("checkoutTokenFromGid extracts numeric id", () => {
  assert.equal(checkoutTokenFromGid("gid://shopify/AbandonedCheckout/123"), "123");
});

test("stranded when completed and no order", () => {
  assert.equal(isStranded(checkout(), false), true);
});

test("not stranded when order exists", () => {
  assert.equal(isStranded(checkout(), true), false);
});

test("not stranded when never completed", () => {
  assert.equal(isStranded(checkout({ completedAt: null }), false), false);
});

test("not stranded when below minimum cents", () => {
  const tiny = checkout({ totalPriceSet: { shopMoney: { amount: "0.00", currencyCode: "USD" } } });
  assert.equal(isStranded(tiny, false, 1), false);
});

test("stranded respects custom minimum", () => {
  const small = checkout({ totalPriceSet: { shopMoney: { amount: "0.50", currencyCode: "USD" } } });
  assert.equal(isStranded(small, false, 100), false);
  assert.equal(isStranded(small, false, 10), true);
});
