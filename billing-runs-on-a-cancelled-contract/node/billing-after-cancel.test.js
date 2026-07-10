import { test } from "node:test";
import assert from "node:assert/strict";
import { attemptRanAfterCancel, attemptsNeedingReview } from "./flag-attempts-after-cancel.js";

const contract = ({ status = "CANCELLED", cancelledAt = "2026-06-01T00:00:00Z", attempts = [] } = {}) => ({
  id: "gid://shopify/SubscriptionContract/1",
  status,
  cancelledAt,
  billingAttempts: { nodes: attempts },
});

const attempt = (createdAt, { ready = true, order = null } = {}) => ({
  id: "gid://shopify/SubscriptionBillingAttempt/1",
  createdAt,
  ready,
  order,
});

test("flags order created after cancel", () => {
  const c = contract();
  const a = attempt("2026-06-02T00:00:00Z", { order: { id: "gid://shopify/Order/1", name: "#1001", tags: [] } });
  assert.equal(attemptRanAfterCancel(c, a), true);
});

test("flags pending attempt after cancel even without an order yet", () => {
  const c = contract();
  const a = attempt("2026-06-02T00:00:00Z", { ready: false, order: null });
  assert.equal(attemptRanAfterCancel(c, a), true);
});

test("ignores attempt before cancel", () => {
  const c = contract();
  const a = attempt("2026-05-20T00:00:00Z", { order: { id: "gid://shopify/Order/1", name: "#1001", tags: [] } });
  assert.equal(attemptRanAfterCancel(c, a), false);
});

test("ignores active contract", () => {
  const c = contract({ status: "ACTIVE" });
  const a = attempt("2026-06-02T00:00:00Z", { order: { id: "gid://shopify/Order/1", name: "#1001", tags: [] } });
  assert.equal(attemptRanAfterCancel(c, a), false);
});

test("ignores contract without cancelledAt", () => {
  const c = contract({ cancelledAt: null });
  const a = attempt("2026-06-02T00:00:00Z", { order: { id: "gid://shopify/Order/1", name: "#1001", tags: [] } });
  assert.equal(attemptRanAfterCancel(c, a), false);
});

test("ignores resolved attempt with no order at the cancel boundary", () => {
  const c = contract();
  const a = attempt("2026-06-01T00:00:00Z", { ready: true, order: null });
  assert.equal(attemptRanAfterCancel(c, a), false);
});

test("attemptsNeedingReview filters a mixed list", () => {
  const c = contract({
    attempts: [
      attempt("2026-05-20T00:00:00Z", { order: { id: "gid://shopify/Order/1", name: "#1001", tags: [] } }),
      attempt("2026-06-02T00:00:00Z", { order: { id: "gid://shopify/Order/2", name: "#1002", tags: [] } }),
    ],
  });
  const flagged = attemptsNeedingReview(c);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].order.name, "#1002");
});
