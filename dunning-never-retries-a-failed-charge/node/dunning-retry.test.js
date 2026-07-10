import { test } from "node:test";
import assert from "node:assert/strict";
import { failedAttemptCount, retryDecision } from "./retry-failed-billing.js";

const attempt = (createdAt, completedAt = null) => ({
  id: "gid://shopify/SubscriptionBillingAttempt/1",
  createdAt,
  completedAt,
});

const contract = (over = {}) => ({
  id: "gid://shopify/SubscriptionContract/1",
  lastPaymentStatus: "FAILED",
  billingAttempts: [attempt("2026-07-05T00:00:00Z")],
  ...over,
});

test("failedAttemptCount stops at first completed", () => {
  const attempts = [
    attempt("2026-07-05T00:00:00Z"),
    attempt("2026-07-02T00:00:00Z"),
    attempt("2026-06-20T00:00:00Z", "2026-06-20T00:05:00Z"),
  ];
  assert.equal(failedAttemptCount(attempts), 2);
});

test("failedAttemptCount zero when most recent succeeded", () => {
  const attempts = [attempt("2026-07-05T00:00:00Z", "2026-07-05T00:05:00Z")];
  assert.equal(failedAttemptCount(attempts), 0);
});

test("no retry when last payment not failed", () => {
  assert.equal(retryDecision(contract({ lastPaymentStatus: "SUCCEEDED" }), "2026-07-10T00:00:00Z"), false);
});

test("no retry before the backoff window", () => {
  const c = contract({ billingAttempts: [attempt("2026-07-09T20:00:00Z")] });
  assert.equal(retryDecision(c, "2026-07-10T00:00:00Z"), false);
});

test("retry once first backoff window elapses", () => {
  const c = contract({ billingAttempts: [attempt("2026-07-09T00:00:00Z")] });
  assert.equal(retryDecision(c, "2026-07-10T00:00:00Z"), true);
});

test("retry uses longer window for later attempts", () => {
  const attempts = [attempt("2026-07-08T00:00:00Z"), attempt("2026-07-05T00:00:00Z")];
  const c = contract({ billingAttempts: attempts });
  assert.equal(retryDecision(c, "2026-07-10T00:00:00Z"), false);
});

test("retry when third backoff window elapses", () => {
  const attempts = [
    attempt("2026-07-03T00:00:00Z"),
    attempt("2026-06-30T00:00:00Z"),
    attempt("2026-06-27T00:00:00Z"),
  ];
  const c = contract({ billingAttempts: attempts });
  assert.equal(retryDecision(c, "2026-07-10T00:00:00Z"), true);
});

test("no retry after max retries exhausted", () => {
  const attempts = [
    attempt("2026-07-01T00:00:00Z"),
    attempt("2026-06-28T00:00:00Z"),
    attempt("2026-06-25T00:00:00Z"),
    attempt("2026-06-20T00:00:00Z"),
  ];
  const c = contract({ billingAttempts: attempts });
  assert.equal(retryDecision(c, "2026-07-20T00:00:00Z"), false);
});

test("no retry with no billing history", () => {
  const c = contract({ billingAttempts: [] });
  assert.equal(retryDecision(c, "2026-07-10T00:00:00Z"), false);
});
