import { test } from "node:test";
import assert from "node:assert/strict";
import { holdsToRelease, RELEASABLE_REASONS } from "./release-fulfillment-holds.js";

const hold = (over = {}) => ({
  id: "gid://shopify/FulfillmentHold/1",
  reason: "INVENTORY_OUT_OF_STOCK",
  reasonNotes: "Waiting on new shipment",
  heldByRequestingApp: true,
  ...over,
});

const fulfillmentOrder = (over = {}) => ({
  id: "gid://shopify/FulfillmentOrder/1",
  status: "ON_HOLD",
  order: { id: "gid://shopify/Order/1", name: "#1001", tags: ["hold-resolved"] },
  fulfillmentHolds: [hold()],
  ...over,
});

test("releases when on hold, tagged, and reason is releasable", () => {
  const fo = fulfillmentOrder();
  assert.deepEqual(holdsToRelease(fo, "hold-resolved"), ["gid://shopify/FulfillmentHold/1"]);
});

test("skips when not on hold", () => {
  const fo = fulfillmentOrder({ status: "OPEN" });
  assert.deepEqual(holdsToRelease(fo, "hold-resolved"), []);
});

test("skips when order missing confirmation tag", () => {
  const fo = fulfillmentOrder({ order: { id: "gid://shopify/Order/1", name: "#1001", tags: [] } });
  assert.deepEqual(holdsToRelease(fo, "hold-resolved"), []);
});

test("skips holds not applied by this app", () => {
  const fo = fulfillmentOrder({ fulfillmentHolds: [hold({ heldByRequestingApp: false })] });
  assert.deepEqual(holdsToRelease(fo, "hold-resolved"), []);
});

test("skips high risk of fraud even if tagged", () => {
  const fo = fulfillmentOrder({ fulfillmentHolds: [hold({ reason: "HIGH_RISK_OF_FRAUD" })] });
  assert.deepEqual(holdsToRelease(fo, "hold-resolved"), []);
  assert.equal(RELEASABLE_REASONS.has("HIGH_RISK_OF_FRAUD"), false);
});

test("only releases the matching holds on a multi hold order", () => {
  const fo = fulfillmentOrder({
    fulfillmentHolds: [
      hold({ id: "gid://shopify/FulfillmentHold/1", reason: "INVENTORY_OUT_OF_STOCK" }),
      hold({ id: "gid://shopify/FulfillmentHold/2", reason: "HIGH_RISK_OF_FRAUD" }),
      hold({ id: "gid://shopify/FulfillmentHold/3", heldByRequestingApp: false }),
      hold({ id: "gid://shopify/FulfillmentHold/4", reason: "INCORRECT_ADDRESS" }),
    ],
  });
  assert.deepEqual(holdsToRelease(fo, "hold-resolved"), [
    "gid://shopify/FulfillmentHold/1",
    "gid://shopify/FulfillmentHold/4",
  ]);
});

test("no holds means nothing to release", () => {
  const fo = fulfillmentOrder({ fulfillmentHolds: [] });
  assert.deepEqual(holdsToRelease(fo, "hold-resolved"), []);
});
