import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toCents,
  findDuplicateWebhookId,
  alreadyFlagged,
  shouldFlagForReview,
} from "./dedupe-webhook-deliveries.js";

const PREFIX = "wh-";
const REVIEW_TAG = "duplicate-webhook";

const order = (tags) => ({ tags });

test("toCents rounds", () => {
  assert.equal(toCents("19.99"), 1999);
  assert.equal(toCents("50.00"), 5000);
});

test("no duplicate when each webhook id seen once", () => {
  assert.equal(findDuplicateWebhookId(["wh-abc123", "wh-def456"], PREFIX), null);
});

test("finds duplicate webhook id", () => {
  assert.equal(findDuplicateWebhookId(["wh-abc123", "wh-def456", "wh-abc123"], PREFIX), "abc123");
});

test("ignores tags without prefix", () => {
  assert.equal(findDuplicateWebhookId(["vip", "wh-abc123", "wh-abc123"], PREFIX), "abc123");
});

test("no duplicate with no webhook tags", () => {
  assert.equal(findDuplicateWebhookId([], PREFIX), null);
  assert.equal(findDuplicateWebhookId(undefined, PREFIX), null);
});

test("alreadyFlagged true when review tag present", () => {
  assert.equal(alreadyFlagged(["duplicate-webhook"], REVIEW_TAG), true);
});

test("alreadyFlagged false when absent", () => {
  assert.equal(alreadyFlagged(["vip"], REVIEW_TAG), false);
});

test("should flag when duplicate and not yet flagged", () => {
  assert.equal(shouldFlagForReview(order(["wh-abc123", "wh-abc123"]), PREFIX, REVIEW_TAG), true);
});

test("should not flag when no duplicate", () => {
  assert.equal(shouldFlagForReview(order(["wh-abc123", "wh-def456"]), PREFIX, REVIEW_TAG), false);
});

test("should not flag when already flagged", () => {
  assert.equal(
    shouldFlagForReview(order(["wh-abc123", "wh-abc123", "duplicate-webhook"]), PREFIX, REVIEW_TAG),
    false
  );
});
