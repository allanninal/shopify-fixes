import { test } from "node:test";
import assert from "node:assert/strict";
import { eligibleToTrack } from "./fix-untracked-items.js";

const variant = (over = {}) => ({
  inventoryItem: { id: "gid://shopify/InventoryItem/1", tracked: false },
  product: { tags: ["track-me"] },
  ...over,
});

test("eligible when untracked, sold, and tagged", () => {
  assert.equal(eligibleToTrack(variant(), 3, "track-me"), true);
});

test("skip when already tracked", () => {
  const v = variant({ inventoryItem: { id: "gid://shopify/InventoryItem/1", tracked: true } });
  assert.equal(eligibleToTrack(v, 3, "track-me"), false);
});

test("skip when no recent sales", () => {
  assert.equal(eligibleToTrack(variant(), 0, "track-me"), false);
});

test("skip without tag", () => {
  const v = variant({ product: { tags: [] } });
  assert.equal(eligibleToTrack(v, 3, "track-me"), false);
});

test("respects custom minimum sales", () => {
  assert.equal(eligibleToTrack(variant(), 2, "track-me", 5), false);
  assert.equal(eligibleToTrack(variant(), 5, "track-me", 5), true);
});

test("missing inventory item defaults to untracked", () => {
  const v = variant({ inventoryItem: {} });
  assert.equal(eligibleToTrack(v, 3, "track-me"), true);
});

test("missing product tags defaults to no tags", () => {
  const v = variant({ product: {} });
  assert.equal(eligibleToTrack(v, 3, "track-me"), false);
});
