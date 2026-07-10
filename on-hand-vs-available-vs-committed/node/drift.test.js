import { test } from "node:test";
import assert from "node:assert/strict";
import { quantitiesByName, driftForLevel, levelsWithDrift } from "./find-available-vs-committed-drift.js";

const level = (over = {}) => {
  const quantities = [
    { name: "available", quantity: 10 },
    { name: "on_hand", quantity: 10 },
    { name: "committed", quantity: 0 },
    { name: "damaged", quantity: 0 },
    { name: "safety_stock", quantity: 0 },
  ];
  for (const [name, value] of Object.entries(over)) {
    const q = quantities.find((q) => q.name === name);
    if (q) q.quantity = value;
  }
  return { location: { id: "gid://shopify/Location/1", name: "Warehouse" }, quantities };
};

test("quantitiesByName fills missing names with zero", () => {
  const q = quantitiesByName({ quantities: [{ name: "available", quantity: 5 }] });
  assert.equal(q.available, 5);
  assert.equal(q.committed, 0);
  assert.equal(q.damaged, 0);
});

test("no drift when available matches on_hand minus committed", () => {
  assert.equal(driftForLevel(level({ on_hand: 10, committed: 4, available: 6 })), 0);
});

test("drift when available was never reduced by committed", () => {
  assert.equal(driftForLevel(level({ on_hand: 10, committed: 4, available: 10 })), 4);
});

test("drift accounts for damaged and safety stock", () => {
  assert.equal(
    driftForLevel(level({ on_hand: 20, committed: 5, damaged: 2, safety_stock: 3, available: 10 })),
    0
  );
  assert.equal(
    driftForLevel(level({ on_hand: 20, committed: 5, damaged: 2, safety_stock: 3, available: 15 })),
    5
  );
});

test("negative drift when available overcorrected", () => {
  assert.equal(driftForLevel(level({ on_hand: 10, committed: 0, available: 8 })), -2);
});

test("levelsWithDrift only returns offending locations", () => {
  const item = {
    inventoryLevels: {
      nodes: [
        level({ on_hand: 10, committed: 4, available: 6 }),
        level({ on_hand: 10, committed: 4, available: 10 }),
      ],
    },
  };
  const result = levelsWithDrift(item);
  assert.equal(result.length, 1);
  assert.equal(result[0].drift, 4);
  assert.equal(result[0].locationName, "Warehouse");
});

test("levelsWithDrift is empty when everything ties out", () => {
  const item = {
    inventoryLevels: {
      nodes: [level(), level({ on_hand: 5, committed: 2, available: 3 })],
    },
  };
  assert.deepEqual(levelsWithDrift(item), []);
});
