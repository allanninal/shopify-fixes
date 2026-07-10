import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReview, impliedRate, toCents } from "./find-currency-mismatch.js";

const totals = (shopAmount, shopCcy, presentmentAmount, presentmentCcy) => ({
  shopMoney: { amount: shopAmount, currencyCode: shopCcy },
  presentmentMoney: { amount: presentmentAmount, currencyCode: presentmentCcy },
});

const order = (totalReceived, tags = []) => ({ totalReceivedSet: totalReceived, tags });

test("toCents rounds", () => {
  assert.equal(toCents("50.00"), 5000);
  assert.equal(toCents("9.99"), 999);
});

test("impliedRate is null when shop side is zero", () => {
  assert.equal(impliedRate(0, 5000), null);
});

test("impliedRate computes ratio", () => {
  // 100 GBP presentment for 128 USD settlement -> ~0.78 GBP per USD
  assert.equal(Math.round(impliedRate(12800, 10000) * 100) / 100, 0.78);
});

test("no review when same currency and amounts match", () => {
  const o = order(totals("50.00", "USD", "50.00", "USD"));
  assert.equal(needsReview(o, "USD", 0.01, 100), false);
});

test("review when settlement currency is not the expected one", () => {
  const o = order(totals("45.00", "EUR", "50.00", "USD"));
  assert.equal(needsReview(o, "USD", 0.01, 100), true);
});

test("review when same currency but amounts differ", () => {
  const o = order(totals("50.00", "USD", "48.00", "USD"));
  assert.equal(needsReview(o, "USD", 0.01, 100), true);
});

test("no review when rate is sane", () => {
  const o = order(totals("100.00", "USD", "92.00", "EUR"));
  assert.equal(needsReview(o, "USD", 0.01, 100), false);
});

test("review when rate is absurd", () => {
  const o = order(totals("1000.00", "USD", "1.00", "EUR"));
  assert.equal(needsReview(o, "USD", 0.01, 100), true);
});

test("review when presentment amount missing", () => {
  const o = order(totals("100.00", "USD", "0", "EUR"));
  assert.equal(needsReview(o, "USD", 0.01, 100), true);
});

test("no review when currency fields missing", () => {
  const o = order({ shopMoney: {}, presentmentMoney: {} });
  assert.equal(needsReview(o, "USD", 0.01, 100), false);
});
