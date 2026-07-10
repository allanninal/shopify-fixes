import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaleUnfulfilled, isOnHold, isoToEpoch } from "./flag-stale-unfulfilled.js";

const NOW = isoToEpoch("2026-07-10T00:00:00Z");

const order = (over = {}) => ({
  displayFulfillmentStatus: "UNFULFILLED",
  createdAt: "2026-07-01T00:00:00Z",
  tags: [],
  fulfillmentOrders: { nodes: [{ status: "OPEN" }] },
  ...over,
});

test("stale when old and unfulfilled", () => {
  assert.equal(isStaleUnfulfilled(order(), NOW, 3, "fulfillment-overdue"), true);
});

test("not stale when recent", () => {
  assert.equal(isStaleUnfulfilled(order({ createdAt: "2026-07-09T00:00:00Z" }), NOW, 3, "fulfillment-overdue"), false);
});

test("not stale when already fulfilled", () => {
  assert.equal(isStaleUnfulfilled(order({ displayFulfillmentStatus: "FULFILLED" }), NOW, 3, "fulfillment-overdue"), false);
});

test("not stale when already tagged", () => {
  assert.equal(isStaleUnfulfilled(order({ tags: ["fulfillment-overdue"] }), NOW, 3, "fulfillment-overdue"), false);
});

test("not stale when on hold", () => {
  assert.equal(isStaleUnfulfilled(order({ fulfillmentOrders: { nodes: [{ status: "ON_HOLD" }] } }), NOW, 3, "fulfillment-overdue"), false);
});

test("isOnHold detects held fulfillment", () => {
  assert.equal(isOnHold(order({ fulfillmentOrders: { nodes: [{ status: "OPEN" }, { status: "ON_HOLD" }] } })), true);
});

test("not stale when missing createdAt", () => {
  assert.equal(isStaleUnfulfilled(order({ createdAt: null }), NOW, 3, "fulfillment-overdue"), false);
});

test("exactly at SLA is stale", () => {
  assert.equal(isStaleUnfulfilled(order({ createdAt: "2026-07-07T00:00:00Z" }), NOW, 3, "fulfillment-overdue"), true);
});
