import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEmail,
  groupByEmail,
  chooseSurvivor,
  planMerge,
  mergePreviewIsClean,
  toCents,
} from "./find-duplicate-customers.js";

const customer = (id, email, { orders = 0, created = "2024-01-01T00:00:00Z", tags = [] } = {}) => ({
  id,
  email,
  numberOfOrders: orders,
  createdAt: created,
  tags,
});

test("toCents rounds", () => {
  assert.equal(toCents("50.00"), 5000);
  assert.equal(toCents("9.99"), 999);
});

test("normalizeEmail folds case and trims", () => {
  assert.equal(normalizeEmail(" Buyer@Example.com "), "buyer@example.com");
  assert.equal(normalizeEmail(undefined), "");
});

test("groupByEmail only returns duplicates", () => {
  const customers = [
    customer("gid://1", "a@example.com"),
    customer("gid://2", "a@example.com"),
    customer("gid://3", "b@example.com"),
  ];
  const groups = groupByEmail(customers);
  assert.deepEqual(Object.keys(groups), ["a@example.com"]);
  assert.equal(groups["a@example.com"].length, 2);
});

test("groupByEmail is case insensitive", () => {
  const customers = [
    customer("gid://1", "Buyer@Example.com"),
    customer("gid://2", "buyer@example.com"),
  ];
  const groups = groupByEmail(customers);
  assert.equal(groups["buyer@example.com"].length, 2);
});

test("chooseSurvivor prefers more orders", () => {
  const a = customer("gid://1", "x@example.com", { orders: 1, created: "2024-05-01T00:00:00Z" });
  const b = customer("gid://2", "x@example.com", { orders: 5, created: "2024-06-01T00:00:00Z" });
  assert.equal(chooseSurvivor([a, b]), b);
});

test("chooseSurvivor breaks tie with older record", () => {
  const a = customer("gid://1", "x@example.com", { orders: 2, created: "2024-06-01T00:00:00Z" });
  const b = customer("gid://2", "x@example.com", { orders: 2, created: "2023-01-01T00:00:00Z" });
  assert.equal(chooseSurvivor([a, b]), b);
});

test("planMerge merges a clean pair", () => {
  const a = customer("gid://1", "x@example.com", { orders: 1 });
  const b = customer("gid://2", "x@example.com", { orders: 5 });
  const decision = planMerge([a, b]);
  assert.equal(decision.action, "merge");
  assert.equal(decision.survivor, b);
  assert.equal(decision.loser, a);
});

test("planMerge skips groups of three", () => {
  const a = customer("gid://1", "x@example.com");
  const b = customer("gid://2", "x@example.com");
  const c = customer("gid://3", "x@example.com");
  const decision = planMerge([a, b, c]);
  assert.equal(decision.action, "skip");
});

test("planMerge skips a protected customer", () => {
  const a = customer("gid://1", "x@example.com", { tags: ["do-not-merge"] });
  const b = customer("gid://2", "x@example.com");
  const decision = planMerge([a, b]);
  assert.equal(decision.action, "skip");
});

test("mergePreviewIsClean true when no conflicts", () => {
  assert.equal(mergePreviewIsClean({ conflictingFields: [] }), true);
  assert.equal(mergePreviewIsClean({}), true);
});

test("mergePreviewIsClean false when conflicts present", () => {
  assert.equal(mergePreviewIsClean({ conflictingFields: [{ description: "Default address" }] }), false);
});
