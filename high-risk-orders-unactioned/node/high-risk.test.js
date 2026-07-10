import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReview, isHighRisk } from "./flag-high-risk.js";

const order = (over = {}) => ({
  cancelledAt: null,
  tags: [],
  risk: { recommendation: "INVESTIGATE", assessments: [{ riskLevel: "HIGH" }] },
  ...over,
});

test("high risk when an assessment is HIGH", () => {
  assert.equal(isHighRisk(order()), true);
});

test("high risk when recommendation is CANCEL", () => {
  assert.equal(isHighRisk(order({ risk: { recommendation: "CANCEL", assessments: [{ riskLevel: "LOW" }] } })), true);
});

test("not high risk when all low", () => {
  assert.equal(isHighRisk(order({ risk: { recommendation: "ACCEPT", assessments: [{ riskLevel: "LOW" }] } })), false);
});

test("needsReview true for untagged high risk", () => {
  assert.equal(needsReview(order(), "fraud-review"), true);
});

test("needsReview false when already tagged", () => {
  assert.equal(needsReview(order({ tags: ["fraud-review"] }), "fraud-review"), false);
});

test("needsReview false when cancelled", () => {
  assert.equal(needsReview(order({ cancelledAt: "2026-07-10T00:00:00Z" }), "fraud-review"), false);
});
