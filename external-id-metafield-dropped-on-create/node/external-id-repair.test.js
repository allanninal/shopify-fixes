import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRepair, planRepairs } from "./repair-external-id-metafield.js";

const order = (name = "#1001", value = null) => ({
  id: `gid://shopify/Order/${name.replace("#", "")}`,
  name,
  metafield: value !== null ? { id: "gid://shopify/Metafield/1", value } : null,
});

test("needs repair when metafield missing", () => {
  assert.equal(needsRepair(order("#1001", null), "ext-9001"), true);
});

test("needs repair when value does not match", () => {
  assert.equal(needsRepair(order("#1001", "ext-old"), "ext-9001"), true);
});

test("no repair when value already matches", () => {
  assert.equal(needsRepair(order("#1001", "ext-9001"), "ext-9001"), false);
});

test("no repair when no expected id known", () => {
  assert.equal(needsRepair(order("#1001", null), null), false);
});

test("plan repairs only includes mismatches", () => {
  const orders = [
    order("#1001", null),
    order("#1002", "ext-2002"),
    order("#1003", "ext-stale"),
  ];
  const lookup = { "#1001": "ext-1001", "#1002": "ext-2002", "#1003": "ext-3003" };
  const plan = planRepairs(orders, lookup);
  const names = plan.map(([o]) => o.name).sort();
  assert.deepEqual(names, ["#1001", "#1003"]);
});

test("plan repairs skips orders with no lookup entry", () => {
  const orders = [order("#1004", null)];
  const plan = planRepairs(orders, {});
  assert.deepEqual(plan, []);
});
