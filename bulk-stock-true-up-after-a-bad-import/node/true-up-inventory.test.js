import { test } from "node:test";
import assert from "node:assert/strict";
import { planCorrection, loadSnapshot, batches } from "./true-up-inventory.js";

test("no correction when matching", () => {
  assert.equal(planCorrection("SKU-1", 10, { "SKU-1": 10 }, 500), null);
});

test("no correction when missing from snapshot", () => {
  assert.equal(planCorrection("SKU-1", 10, {}, 500), null);
});

test("correction when drift positive", () => {
  assert.deepEqual(
    planCorrection("SKU-1", 3, { "SKU-1": 40 }, 500),
    { sku: "SKU-1", from: 3, to: 40, delta: 37 },
  );
});

test("correction when drift negative", () => {
  assert.deepEqual(
    planCorrection("SKU-1", 90, { "SKU-1": 12 }, 500),
    { sku: "SKU-1", from: 90, to: 12, delta: -78 },
  );
});

test("no correction when drift exceeds guard", () => {
  assert.equal(planCorrection("SKU-1", 5, { "SKU-1": 5000 }, 500), null);
});

test("correction allowed at exact guard boundary", () => {
  const decision = planCorrection("SKU-1", 0, { "SKU-1": 500 }, 500);
  assert.equal(decision.delta, 500);
});

test("loadSnapshot reads csv by sku", () => {
  const csv = "sku,available\nSKU-1,40\nSKU-2,0\n,99\n";
  assert.deepEqual(loadSnapshot(csv), { "SKU-1": 40, "SKU-2": 0 });
});

test("batches splits into chunks of the given size", () => {
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("batches returns empty array for empty input", () => {
  assert.deepEqual(batches([], 25), []);
});
