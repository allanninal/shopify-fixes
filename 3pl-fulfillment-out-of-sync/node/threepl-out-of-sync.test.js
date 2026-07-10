import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasShippedTracking,
  fulfillmentOrderOutOfSync,
  orderNeedsReview,
} from "./flag-fulfillment-out-of-sync.js";

const tracking = (number = "1Z999", company = "UPS") => ({ company, number, url: "https://example.com/track" });

const fulfillment = ({ status = "SUCCESS", trackingInfo } = {}) => ({
  status,
  trackingInfo: trackingInfo !== undefined ? trackingInfo : [tracking()],
});

const fulfillmentOrder = ({ status = "IN_PROGRESS", fulfillments = [] } = {}) => ({
  status,
  fulfillments: { nodes: fulfillments },
});

const order = (fulfillmentOrders) => ({ fulfillmentOrders: { nodes: fulfillmentOrders } });

test("out of sync when in progress but shipped with tracking", () => {
  const fo = fulfillmentOrder({ status: "IN_PROGRESS", fulfillments: [fulfillment()] });
  assert.equal(fulfillmentOrderOutOfSync(fo), true);
});

test("out of sync when open but shipped with tracking", () => {
  const fo = fulfillmentOrder({ status: "OPEN", fulfillments: [fulfillment()] });
  assert.equal(fulfillmentOrderOutOfSync(fo), true);
});

test("not out of sync when closed", () => {
  const fo = fulfillmentOrder({ status: "CLOSED", fulfillments: [fulfillment()] });
  assert.equal(fulfillmentOrderOutOfSync(fo), false);
});

test("not out of sync when no fulfillments yet", () => {
  const fo = fulfillmentOrder({ status: "IN_PROGRESS", fulfillments: [] });
  assert.equal(fulfillmentOrderOutOfSync(fo), false);
});

test("not out of sync when fulfillment failed", () => {
  const fo = fulfillmentOrder({ status: "IN_PROGRESS", fulfillments: [fulfillment({ status: "FAILURE" })] });
  assert.equal(fulfillmentOrderOutOfSync(fo), false);
});

test("not out of sync when success but no tracking number", () => {
  const fo = fulfillmentOrder({
    status: "IN_PROGRESS",
    fulfillments: [fulfillment({ trackingInfo: [{ company: "UPS", number: "", url: "" }] })],
  });
  assert.equal(fulfillmentOrderOutOfSync(fo), false);
});

test("hasShippedTracking requires success and a number", () => {
  assert.equal(hasShippedTracking(fulfillment()), true);
  assert.equal(hasShippedTracking(fulfillment({ status: "CANCELLED" })), false);
  assert.equal(hasShippedTracking(fulfillment({ trackingInfo: [] })), false);
});

test("orderNeedsReview true when one fulfillment order is out of sync", () => {
  const o = order([
    fulfillmentOrder({ status: "CLOSED", fulfillments: [fulfillment()] }),
    fulfillmentOrder({ status: "IN_PROGRESS", fulfillments: [fulfillment()] }),
  ]);
  assert.equal(orderNeedsReview(o), true);
});

test("orderNeedsReview false when all in sync", () => {
  const o = order([fulfillmentOrder({ status: "CLOSED", fulfillments: [fulfillment()] })]);
  assert.equal(orderNeedsReview(o), false);
});
