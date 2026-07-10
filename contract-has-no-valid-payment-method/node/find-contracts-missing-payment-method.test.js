import { test } from "node:test";
import assert from "node:assert/strict";
import { hasNoValidPaymentMethod, needsTag } from "./find-contracts-missing-payment-method.js";

const contract = (over = {}) => ({
  status: "ACTIVE",
  lastPaymentStatus: "PENDING",
  customerPaymentMethod: { id: "gid://shopify/CustomerPaymentMethod/1", revokedAt: null },
  tags: [],
  ...over,
});

test("flags when lastPaymentStatus says no method", () => {
  assert.equal(hasNoValidPaymentMethod(contract({ lastPaymentStatus: "NO_PAYMENT_METHOD" })), true);
});

test("flags when method is missing", () => {
  assert.equal(hasNoValidPaymentMethod(contract({ customerPaymentMethod: null })), true);
});

test("flags when method was revoked", () => {
  assert.equal(
    hasNoValidPaymentMethod(contract({ customerPaymentMethod: { id: "gid://shopify/CustomerPaymentMethod/1", revokedAt: "2026-06-01T00:00:00Z" } })),
    true
  );
});

test("ok when method present and not revoked", () => {
  assert.equal(hasNoValidPaymentMethod(contract()), false);
});

test("ignores cancelled contracts", () => {
  assert.equal(hasNoValidPaymentMethod(contract({ status: "CANCELLED", customerPaymentMethod: null })), false);
});

test("ignores paused contracts", () => {
  assert.equal(hasNoValidPaymentMethod(contract({ status: "PAUSED", lastPaymentStatus: "NO_PAYMENT_METHOD" })), false);
});

test("needsTag true when broken and untagged", () => {
  assert.equal(needsTag(contract({ customerPaymentMethod: null, tags: [] }), "needs-payment-method"), true);
});

test("needsTag false when already tagged", () => {
  assert.equal(needsTag(contract({ customerPaymentMethod: null, tags: ["needs-payment-method"] }), "needs-payment-method"), false);
});

test("needsTag false when contract is healthy", () => {
  assert.equal(needsTag(contract(), "needs-payment-method"), false);
});
