import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toCents,
  lineItemTaxRate,
  expectedTaxCentsForRefund,
  actualTaxRefundedCents,
  untaxedRefundGapCents,
} from "./find-untaxed-partial-refunds.js";

const lineItem = ({ id = "gid://shopify/LineItem/1", unitPrice = "50.00", quantity = 1, tax = "4.00" } = {}) => ({
  id,
  quantity,
  originalUnitPriceSet: { shopMoney: { amount: unitPrice } },
  taxLines: tax === null ? [] : [{ priceSet: { shopMoney: { amount: tax } } }],
});

const refundLine = ({ lineItemId = "gid://shopify/LineItem/1", subtotal = "50.00", tax = "0.00" } = {}) => ({
  quantity: 1,
  lineItem: { id: lineItemId },
  subtotalSet: { shopMoney: { amount: subtotal } },
  totalTaxSet: { shopMoney: { amount: tax } },
});

const refund = (lines) => ({ refundLineItems: { nodes: lines } });

test("toCents rounds", () => {
  assert.equal(toCents("9.99"), 999);
  assert.equal(toCents("4.00"), 400);
});

test("lineItemTaxRate computes fraction of unit price", () => {
  assert.equal(Math.round(lineItemTaxRate(lineItem({ unitPrice: "50.00", tax: "4.00" })) * 10000) / 10000, 0.08);
});

test("lineItemTaxRate is zero when there are no tax lines", () => {
  assert.equal(lineItemTaxRate(lineItem({ tax: null })), 0);
});

test("lineItemTaxRate is zero when unit price is zero", () => {
  assert.equal(lineItemTaxRate(lineItem({ unitPrice: "0.00" })), 0);
});

test("lineItemTaxRate divides by the full quantity price", () => {
  assert.equal(
    Math.round(lineItemTaxRate(lineItem({ unitPrice: "50.00", quantity: 2, tax: "8.00" })) * 10000) / 10000,
    0.08
  );
});

test("expectedTaxCentsForRefund matches the original rate", () => {
  const items = { "gid://shopify/LineItem/1": lineItem({ unitPrice: "50.00", tax: "4.00" }) };
  const r = refund([refundLine({ subtotal: "50.00", tax: "0.00" })]);
  assert.equal(expectedTaxCentsForRefund(r, items), 400);
});

test("actualTaxRefundedCents sums refund lines", () => {
  const r = refund([refundLine({ tax: "1.50" }), refundLine({ tax: "2.50" })]);
  assert.equal(actualTaxRefundedCents(r), 400);
});

test("gap detects tax left untouched", () => {
  const items = { "gid://shopify/LineItem/1": lineItem({ unitPrice: "50.00", tax: "4.00" }) };
  const r = refund([refundLine({ subtotal: "50.00", tax: "0.00" })]);
  assert.equal(untaxedRefundGapCents(r, items), 400);
});

test("gap is zero when the refund already ties out", () => {
  const items = { "gid://shopify/LineItem/1": lineItem({ unitPrice: "50.00", tax: "4.00" }) };
  const r = refund([refundLine({ subtotal: "50.00", tax: "4.00" })]);
  assert.equal(untaxedRefundGapCents(r, items), 0);
});

test("gap ignores rounding noise under the threshold", () => {
  const items = { "gid://shopify/LineItem/1": lineItem({ unitPrice: "50.00", tax: "4.00" }) };
  const r = refund([refundLine({ subtotal: "50.00", tax: "3.99" })]);
  assert.equal(untaxedRefundGapCents(r, items, 2), 0);
});

test("gap is zero when the refund has no line items", () => {
  assert.equal(untaxedRefundGapCents(refund([]), {}), 0);
});

test("gap never goes negative when tax was over-refunded", () => {
  const items = { "gid://shopify/LineItem/1": lineItem({ unitPrice: "50.00", tax: "4.00" }) };
  const r = refund([refundLine({ subtotal: "50.00", tax: "9.00" })]);
  assert.equal(untaxedRefundGapCents(r, items), 0);
});

test("gap ignores line items missing from the order", () => {
  const r = refund([refundLine({ lineItemId: "gid://shopify/LineItem/999", subtotal: "50.00", tax: "0.00" })]);
  assert.equal(untaxedRefundGapCents(r, {}), 0);
});
