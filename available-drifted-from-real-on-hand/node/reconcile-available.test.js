import { test } from "node:test";
import assert from "node:assert/strict";
import { planReconciliation } from "./reconcile-available.js";

test("no plan when within tolerance", () => {
  assert.equal(planReconciliation(40, 39, 1), null);
});

test("plan when real is higher", () => {
  assert.deepEqual(planReconciliation(40, 31, 1), { quantity: 40, compareQuantity: 31, drift: 9 });
});

test("plan when real is lower", () => {
  assert.deepEqual(planReconciliation(20, 25, 1), { quantity: 20, compareQuantity: 25, drift: -5 });
});

test("exact tolerance boundary is not a drift", () => {
  assert.equal(planReconciliation(10, 8, 2), null);
});

test("one past tolerance is a drift", () => {
  assert.deepEqual(planReconciliation(11, 8, 2), { quantity: 11, compareQuantity: 8, drift: 3 });
});

test("zero tolerance flags any gap", () => {
  assert.deepEqual(planReconciliation(5, 4, 0), { quantity: 5, compareQuantity: 4, drift: 1 });
});

test("rejects negative real count", () => {
  assert.throws(() => planReconciliation(-1, 5, 1));
});

test("rejects negative shopify available", () => {
  assert.throws(() => planReconciliation(5, -1, 1));
});

test("rejects negative tolerance", () => {
  assert.throws(() => planReconciliation(5, 5, -1));
});
