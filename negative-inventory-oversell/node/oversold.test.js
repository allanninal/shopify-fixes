import { test } from "node:test";
import assert from "node:assert/strict";
import { oversoldLevels, availableOf } from "./fix-negative-inventory.js";

const level = (locationId, available) => ({
  location: { id: locationId, name: locationId },
  quantities: [{ name: "available", quantity: available }],
});

const variant = (...levels) => ({
  id: "gid://shopify/ProductVariant/1",
  sku: "SKU1",
  inventoryItem: { id: "gid://shopify/InventoryItem/9", inventoryLevels: { nodes: levels } },
});

test("availableOf reads the named quantity", () => {
  assert.equal(availableOf(level("loc/1", -3)), -3);
});

test("availableOf null when absent", () => {
  assert.equal(availableOf({ quantities: [{ name: "on_hand", quantity: 5 }] }), null);
});

test("no oversold when all non-negative", () => {
  assert.deepEqual(oversoldLevels(variant(level("loc/1", 0), level("loc/2", 5))), []);
});

test("finds single oversold location", () => {
  const out = oversoldLevels(variant(level("loc/1", -2), level("loc/2", 4)));
  assert.equal(out.length, 1);
  assert.equal(out[0].locationId, "loc/1");
  assert.equal(out[0].available, -2);
});

test("finds multiple oversold locations", () => {
  const out = oversoldLevels(variant(level("loc/1", -2), level("loc/2", -7)));
  assert.deepEqual(out.map((l) => l.available).sort((a, b) => a - b), [-7, -2]);
});

test("carries inventory item id", () => {
  const out = oversoldLevels(variant(level("loc/1", -1)));
  assert.equal(out[0].inventoryItemId, "gid://shopify/InventoryItem/9");
});
