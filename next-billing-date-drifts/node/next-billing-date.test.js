import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedNextBillingDateMs, decideRealignment } from "./fix-next-billing-date.js";

const dayMs = (y, m, d) => Date.UTC(y, m - 1, d);

const contract = (over = {}) => ({
  id: "gid://shopify/SubscriptionContract/1",
  status: "ACTIVE",
  nextBillingDate: "2026-08-01",
  createdAt: "2026-06-01T00:00:00Z",
  billingPolicy: { interval: "MONTH", intervalCount: 1 },
  ...over,
});

test("expectedNextBillingDateMs walks whole intervals", () => {
  const origin = dayMs(2026, 1, 1);
  const result = expectedNextBillingDateMs(origin, "MONTH", 1, dayMs(2026, 3, 1));
  assert.equal(result, dayMs(2026, 3, 2));
});

test("expectedNextBillingDateMs before origin returns origin", () => {
  const origin = dayMs(2026, 6, 1);
  assert.equal(expectedNextBillingDateMs(origin, "MONTH", 1, dayMs(2026, 1, 1)), origin);
});

test("no drift within tolerance returns null", () => {
  const c = contract({ nextBillingDate: "2026-07-01", createdAt: "2026-06-01T00:00:00Z" });
  assert.equal(decideRealignment(c, dayMs(2026, 7, 1)), null);
});

test("drift beyond tolerance returns expected iso date", () => {
  const c = contract({ nextBillingDate: "2026-07-01", createdAt: "2026-06-01T00:00:00Z" });
  const result = decideRealignment(c, dayMs(2026, 8, 15));
  assert.notEqual(result, null);
  assert.notEqual(result, "2026-07-01");
});

test("skip when contract not active", () => {
  const c = contract({ status: "CANCELLED", nextBillingDate: "2026-01-01" });
  assert.equal(decideRealignment(c, dayMs(2026, 8, 15)), null);
});

test("skip when billing policy missing fields", () => {
  const c = contract({ billingPolicy: { interval: null, intervalCount: null } });
  assert.equal(decideRealignment(c, dayMs(2026, 8, 15)), null);
});

test("skip when missing dates", () => {
  const c = contract({ nextBillingDate: null });
  assert.equal(decideRealignment(c, dayMs(2026, 8, 15)), null);
});
