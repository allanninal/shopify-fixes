import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateOrders, billingCycleKey, toCents } from "./find-duplicate-renewals.js";

const attempt = (orderId, name, origin, { amount = "29.00", tags = [] } = {}) => ({
  id: `gid://shopify/SubscriptionBillingAttempt/${orderId}`,
  ready: true,
  idempotencyKey: `key-${orderId}`,
  originTime: origin,
  order: {
    id: `gid://shopify/Order/${orderId}`,
    name,
    tags,
    totalPriceSet: { shopMoney: { amount, currencyCode: "USD" } },
  },
});

const contract = (attempts) => ({ id: "gid://shopify/SubscriptionContract/1", billingAttempts: attempts });

test("toCents rounds", () => {
  assert.equal(toCents("29.00"), 2900);
  assert.equal(toCents("9.99"), 999);
});

test("billingCycleKey truncates to day", () => {
  assert.equal(billingCycleKey(attempt(1, "#1001", "2026-07-01T08:00:00Z")), "2026-07-01");
});

test("no duplicates for single attempt per cycle", () => {
  const c = contract([
    attempt(1, "#1001", "2026-06-01T08:00:00Z"),
    attempt(2, "#1002", "2026-07-01T08:00:00Z"),
  ]);
  assert.deepEqual(findDuplicateOrders(c, "duplicate-renewal"), []);
});

test("second attempt same day is a duplicate", () => {
  const c = contract([
    attempt(1, "#1001", "2026-07-01T08:00:00Z"),
    attempt(2, "#1002", "2026-07-01T08:14:00Z"),
  ]);
  const dups = findDuplicateOrders(c, "duplicate-renewal");
  assert.equal(dups.length, 1);
  assert.equal(dups[0].orderId, "gid://shopify/Order/2");
  assert.equal(dups[0].amountCents, 2900);
});

test("first attempt in a cycle is never flagged", () => {
  const c = contract([
    attempt(1, "#1001", "2026-07-01T08:00:00Z"),
    attempt(2, "#1002", "2026-07-01T08:14:00Z"),
    attempt(3, "#1003", "2026-07-01T09:00:00Z"),
  ]);
  const dups = findDuplicateOrders(c, "duplicate-renewal");
  const orderIds = dups.map((d) => d.orderId);
  assert.equal(orderIds.includes("gid://shopify/Order/1"), false);
  assert.equal(dups.length, 2);
});

test("attempts without an order are ignored", () => {
  const failed = attempt(1, "#1001", "2026-07-01T08:00:00Z");
  failed.order = null;
  const ok = attempt(2, "#1002", "2026-07-01T08:14:00Z");
  const c = contract([failed, ok]);
  assert.deepEqual(findDuplicateOrders(c, "duplicate-renewal"), []);
});

test("already tagged duplicate is skipped", () => {
  const c = contract([
    attempt(1, "#1001", "2026-07-01T08:00:00Z"),
    attempt(2, "#1002", "2026-07-01T08:14:00Z", { tags: ["duplicate-renewal"] }),
  ]);
  assert.deepEqual(findDuplicateOrders(c, "duplicate-renewal"), []);
});

test("different cycles are each allowed one charge", () => {
  const c = contract([
    attempt(1, "#1001", "2026-05-01T08:00:00Z"),
    attempt(2, "#1002", "2026-06-01T08:00:00Z"),
    attempt(3, "#1003", "2026-07-01T08:00:00Z"),
  ]);
  assert.deepEqual(findDuplicateOrders(c, "duplicate-renewal"), []);
});
