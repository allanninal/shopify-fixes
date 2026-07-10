import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleToMark } from "./mark-paid.js";

const order = (over = {}) => ({ canMarkAsPaid: true, displayFinancialStatus: "PENDING", tags: ["paid-externally"], ...over });

test("eligible when pending, taggable, and can mark", () => {
  assert.equal(eligibleToMark(order(), "paid-externally"), true);
});

test("skip when cannot mark", () => {
  assert.equal(eligibleToMark(order({ canMarkAsPaid: false }), "paid-externally"), false);
});

test("skip when already paid", () => {
  assert.equal(eligibleToMark(order({ displayFinancialStatus: "PAID" }), "paid-externally"), false);
});

test("skip without tag", () => {
  assert.equal(eligibleToMark(order({ tags: [] }), "paid-externally"), false);
});
