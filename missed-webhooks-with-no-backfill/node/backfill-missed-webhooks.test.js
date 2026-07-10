import { test } from "node:test";
import assert from "node:assert/strict";
import { needsBackfill, summarize, toCents } from "./backfill-missed-webhooks.js";

const GAP_START = "2026-07-05T00:00:00Z";
const GAP_END = "2026-07-06T00:00:00Z";

const order = (over = {}) => ({
  id: "gid://shopify/Order/1",
  name: "#1001",
  tags: [],
  updatedAt: "2026-07-05T12:00:00Z",
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "UNFULFILLED",
  cancelledAt: null,
  totalReceivedSet: { shopMoney: { amount: "50.00", currencyCode: "USD" } },
  ...over,
});

test("toCents rounds", () => {
  assert.equal(toCents("50.00"), 5000);
  assert.equal(toCents("9.99"), 999);
});

test("needs backfill when updated inside gap and untagged", () => {
  assert.equal(needsBackfill(order(), GAP_START, GAP_END, "webhook-backfilled"), true);
});

test("skip when updated before gap", () => {
  const o = order({ updatedAt: "2026-07-04T23:00:00Z" });
  assert.equal(needsBackfill(o, GAP_START, GAP_END, "webhook-backfilled"), false);
});

test("skip when updated after gap", () => {
  const o = order({ updatedAt: "2026-07-06T01:00:00Z" });
  assert.equal(needsBackfill(o, GAP_START, GAP_END, "webhook-backfilled"), false);
});

test("skip when already tagged", () => {
  const o = order({ tags: ["webhook-backfilled"] });
  assert.equal(needsBackfill(o, GAP_START, GAP_END, "webhook-backfilled"), false);
});

test("skip when no updatedAt", () => {
  const o = order({ updatedAt: null });
  assert.equal(needsBackfill(o, GAP_START, GAP_END, "webhook-backfilled"), false);
});

test("boundary timestamps are inclusive", () => {
  assert.equal(needsBackfill(order({ updatedAt: GAP_START }), GAP_START, GAP_END, "webhook-backfilled"), true);
  assert.equal(needsBackfill(order({ updatedAt: GAP_END }), GAP_START, GAP_END, "webhook-backfilled"), true);
});

test("summarize reads money in cents", () => {
  const state = summarize(order({ totalReceivedSet: { shopMoney: { amount: "129.99", currencyCode: "USD" } } }));
  assert.equal(state.totalReceivedCents, 12999);
  assert.equal(state.financialStatus, "PAID");
  assert.equal(state.cancelled, false);
});
