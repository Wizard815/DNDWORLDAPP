import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRST_KEY, keyAfterAll, keyBetween } from "./sortkey.ts";

test("first key is stable and non-empty", () => {
  assert.equal(FIRST_KEY, keyBetween(null, null));
  assert.ok(FIRST_KEY.length > 0);
});

test("appending keeps ascending order", () => {
  const keys: string[] = [];
  for (let i = 0; i < 200; i++) keys.push(keyAfterAll(keys));
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted);
  assert.equal(new Set(keys).size, keys.length);
});

test("prepending keeps ascending order", () => {
  let first = keyBetween(null, null);
  const keys = [first];
  for (let i = 0; i < 200; i++) {
    first = keyBetween(null, first);
    keys.unshift(first);
  }
  assert.deepEqual(keys, [...keys].sort());
});

test("repeatedly inserting into the same gap stays ordered", () => {
  let lo = keyBetween(null, null);
  let hi = keyBetween(lo, null);
  for (let i = 0; i < 500; i++) {
    const mid = keyBetween(lo, hi);
    assert.ok(lo < mid && mid < hi, `${lo} < ${mid} < ${hi} failed at ${i}`);
    // Alternate which side we squeeze, to exercise both branches.
    if (i % 2 === 0) lo = mid;
    else hi = mid;
  }
});

test("out-of-order arguments are rejected", () => {
  const a = keyBetween(null, null);
  const b = keyBetween(a, null);
  assert.throws(() => keyBetween(b, a));
  assert.throws(() => keyBetween(a, a));
});

test("keys never end in a zero digit", () => {
  const keys: string[] = [];
  let lo = keyBetween(null, null);
  for (let i = 0; i < 300; i++) {
    lo = keyBetween(lo, null);
    keys.push(lo);
  }
  for (const k of keys) assert.notEqual(k.slice(-1), "0");
});
