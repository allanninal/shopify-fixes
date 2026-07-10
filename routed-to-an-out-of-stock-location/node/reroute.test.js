import { test } from "node:test";
import assert from "node:assert/strict";
import { totalRemaining, pickRerouteLocation } from "./reroute-out-of-stock-fulfillment.js";

const lineItem = (remaining = 1, id = "gid://shopify/FulfillmentOrderLineItem/1") => ({ id, remainingQuantity: remaining });

const candidate = (locationId, coveredItems, name = "Warehouse B") => ({
  location: { id: locationId, name },
  message: null,
  availableLineItems: { nodes: coveredItems },
});

const fulfillmentOrder = ({ status = "OPEN", lineItems = [lineItem(2)], candidates = [] } = {}) => ({
  id: "gid://shopify/FulfillmentOrder/1",
  status,
  lineItems: { nodes: lineItems },
  locationsForMove: { nodes: candidates },
});

test("totalRemaining sums quantities", () => {
  assert.equal(totalRemaining([lineItem(2), lineItem(3)]), 5);
  assert.equal(totalRemaining([]), 0);
  assert.equal(totalRemaining(undefined), 0);
});

test("skips orders that are not movable", () => {
  const order = fulfillmentOrder({ status: "CLOSED", candidates: [candidate("gid://shopify/Location/2", [lineItem(2)])] });
  assert.equal(pickRerouteLocation(order), null);
});

test("skips orders with nothing left to fulfill", () => {
  const order = fulfillmentOrder({ lineItems: [lineItem(0)], candidates: [candidate("gid://shopify/Location/2", [lineItem(0)])] });
  assert.equal(pickRerouteLocation(order), null);
});

test("skips when no candidate covers all remaining quantity", () => {
  const order = fulfillmentOrder({ lineItems: [lineItem(5)], candidates: [candidate("gid://shopify/Location/2", [lineItem(3)])] });
  assert.equal(pickRerouteLocation(order), null);
});

test("picks the only location that can cover everything", () => {
  const order = fulfillmentOrder({ lineItems: [lineItem(2)], candidates: [candidate("gid://shopify/Location/2", [lineItem(2)])] });
  assert.equal(pickRerouteLocation(order), "gid://shopify/Location/2");
});

test("picks the candidate with the most coverage when several qualify", () => {
  const order = fulfillmentOrder({
    lineItems: [lineItem(2)],
    candidates: [
      candidate("gid://shopify/Location/2", [lineItem(2)]),
      candidate("gid://shopify/Location/3", [lineItem(9)]),
    ],
  });
  assert.equal(pickRerouteLocation(order), "gid://shopify/Location/3");
});

test("ignores a candidate with no message field present", () => {
  const order = fulfillmentOrder({
    lineItems: [lineItem(1)],
    candidates: [{ location: { id: "gid://shopify/Location/4", name: "Pop-up" }, availableLineItems: { nodes: [lineItem(1)] } }],
  });
  assert.equal(pickRerouteLocation(order), "gid://shopify/Location/4");
});
