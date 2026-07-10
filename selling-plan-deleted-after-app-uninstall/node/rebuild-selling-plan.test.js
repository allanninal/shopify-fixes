import { test } from "node:test";
import assert from "node:assert/strict";
import {
  needsSellingPlan,
  discountMinorUnits,
  sellingPlanGroupInput,
} from "./rebuild-selling-plan.js";

const product = (over = {}) => ({
  id: "gid://shopify/Product/1",
  title: "Roast Blend",
  tags: ["subscribe-and-save"],
  sellingPlanGroupsCount: { count: 1 },
  ...over,
});

test("needs rebuild when tagged and count zero", () => {
  assert.equal(
    needsSellingPlan(product({ sellingPlanGroupsCount: { count: 0 } }), "subscribe-and-save"),
    true
  );
});

test("skip when group still present", () => {
  assert.equal(needsSellingPlan(product(), "subscribe-and-save"), false);
});

test("skip when not tagged", () => {
  assert.equal(needsSellingPlan(product({ tags: [] }), "subscribe-and-save"), false);
});

test("skip when tag missing even with zero count", () => {
  assert.equal(
    needsSellingPlan(
      product({ tags: ["unrelated"], sellingPlanGroupsCount: { count: 0 } }),
      "subscribe-and-save"
    ),
    false
  );
});

test("needs rebuild ignores missing count field", () => {
  assert.equal(needsSellingPlan(product({ sellingPlanGroupsCount: {} }), "subscribe-and-save"), true);
});

test("discountMinorUnits rounds to nearest cent", () => {
  assert.equal(discountMinorUnits(1999, 10), 1799);
  assert.equal(discountMinorUnits(1000, 15), 850);
});

test("discountMinorUnits zero percent is a no-op", () => {
  assert.equal(discountMinorUnits(2500, 0), 2500);
});

test("sellingPlanGroupInput shape", () => {
  const payload = sellingPlanGroupInput("Subscribe and save", 10, "MONTH", 1);
  assert.equal(payload.name, "Subscribe and save");
  assert.equal(payload.merchantCode, "subscribe-and-save");
  const plan = payload.sellingPlansToCreate[0];
  assert.equal(plan.billingPolicy.recurring.interval, "MONTH");
  assert.equal(plan.billingPolicy.recurring.intervalCount, 1);
  assert.equal(plan.pricingPolicies[0].fixed.adjustmentValue.percentage, 10);
});
