import { test } from "node:test";
import assert from "node:assert/strict";
import { missingSubscriptions } from "./recreate-missing-webhooks.js";

const existing = (topic, uri) => ({ topic, uri, id: "gid://shopify/WebhookSubscription/1", format: "JSON" });
const required = (topic, uri) => ({ topic, uri });

test("no gap when everything is registered", () => {
  const current = [existing("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")];
  const need = [required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")];
  assert.deepEqual(missingSubscriptions(current, need), []);
});

test("gap when topic is missing entirely", () => {
  const current = [];
  const need = [required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")];
  assert.deepEqual(missingSubscriptions(current, need), need);
});

test("gap when uri does not match", () => {
  const current = [existing("ORDERS_PAID", "https://old.example.com/hooks/orders-paid")];
  const need = [required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")];
  assert.deepEqual(missingSubscriptions(current, need), need);
});

test("only the missing ones are returned", () => {
  const current = [existing("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")];
  const need = [
    required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid"),
    required("FULFILLMENTS_CREATE", "https://app.example.com/hooks/fulfillments-create"),
  ];
  assert.deepEqual(missingSubscriptions(current, need), [need[1]]);
});

test("topic comparison is case-insensitive", () => {
  const current = [existing("orders_paid", "https://app.example.com/hooks/orders-paid")];
  const need = [required("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")];
  assert.deepEqual(missingSubscriptions(current, need), []);
});

test("empty required returns empty", () => {
  const current = [existing("ORDERS_PAID", "https://app.example.com/hooks/orders-paid")];
  assert.deepEqual(missingSubscriptions(current, []), []);
});
