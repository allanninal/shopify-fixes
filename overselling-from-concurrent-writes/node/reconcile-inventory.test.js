import { test } from "node:test";
import assert from "node:assert/strict";
import { planWrite, availableQuantity } from "./reconcile-inventory.js";

test("no write when already correct", () => {
  assert.equal(planWrite("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 5), null);
});

test("write carries compareQuantity as the current value", () => {
  const write = planWrite("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 4);
  const q = write.quantities[0];
  assert.equal(q.compareQuantity, 5);
  assert.equal(q.quantity, 4);
});

test("write targets the right item and location", () => {
  const write = planWrite("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 4);
  const q = write.quantities[0];
  assert.equal(q.inventoryItemId, "gid://shopify/InventoryItem/1");
  assert.equal(q.locationId, "gid://shopify/Location/1");
});

test("write never forces through compare failures", () => {
  const write = planWrite("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 4);
  assert.equal(write.ignoreCompareQuantityFailures, false);
});

test("write handles downward and upward corrections", () => {
  const down = planWrite("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 4);
  const up = planWrite("gid://shopify/InventoryItem/1", "gid://shopify/Location/1", 5, 8);
  assert.equal(down.quantities[0].quantity, 4);
  assert.equal(up.quantities[0].quantity, 8);
});

test("availableQuantity reads the named entry", () => {
  const node = { quantities: [{ name: "committed", quantity: 2 }, { name: "available", quantity: 7 }] };
  assert.equal(availableQuantity(node), 7);
});

test("availableQuantity missing returns null", () => {
  assert.equal(availableQuantity({ quantities: [{ name: "committed", quantity: 2 }] }), null);
});

test("availableQuantity handles empty list", () => {
  assert.equal(availableQuantity({ quantities: [] }), null);
});
