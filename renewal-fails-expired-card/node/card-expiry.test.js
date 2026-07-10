import { test } from "node:test";
import assert from "node:assert/strict";
import { cardExpired, needsUpdate } from "./notify-expired-cards.js";

const contract = (over = {}) => ({
  status: "ACTIVE",
  customerPaymentMethod: {
    id: "gid://shopify/CustomerPaymentMethod/1",
    revokedAt: null,
    instrument: { expiryMonth: 1, expiryYear: 2025 },
  },
  ...over,
});

test("card expired before this month", () => {
  assert.equal(cardExpired(1, 2025, 2026, 7), true);
});

test("card not expired this month", () => {
  assert.equal(cardExpired(7, 2026, 2026, 7), false);
});

test("card not expired future year", () => {
  assert.equal(cardExpired(1, 2027, 2026, 7), false);
});

test("card missing fields not expired", () => {
  assert.equal(cardExpired(null, null, 2026, 7), false);
});

test("needsUpdate for expired card", () => {
  assert.equal(needsUpdate(contract(), 2026, 7), true);
});

test("needsUpdate for revoked method", () => {
  const c = contract({ customerPaymentMethod: { id: "pm", revokedAt: "2026-01-01T00:00:00Z", instrument: { expiryMonth: 1, expiryYear: 2099 } } });
  assert.equal(needsUpdate(c, 2026, 7), true);
});

test("no update when card valid", () => {
  const c = contract({ customerPaymentMethod: { id: "pm", revokedAt: null, instrument: { expiryMonth: 12, expiryYear: 2099 } } });
  assert.equal(needsUpdate(c, 2026, 7), false);
});

test("no update when not active", () => {
  assert.equal(needsUpdate(contract({ status: "PAUSED" }), 2026, 7), false);
});

test("no update when no payment method", () => {
  assert.equal(needsUpdate(contract({ customerPaymentMethod: null }), 2026, 7), false);
});
