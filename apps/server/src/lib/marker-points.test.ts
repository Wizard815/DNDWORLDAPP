// P4.3 marker-points parser (packages/schema) — the one format definition the
// draw UI, the API validation, and the MCP server all share. The tests here pin
// down what "well-formed" means so none of those three can drift.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatMarkerPoints,
  isWellFormedPoints,
  MAX_MARKER_POINTS,
  parseMarkerPoints,
} from "@dndworldapp/schema";

test("a well-formed point list parses to vertex pairs", () => {
  assert.deepEqual(parseMarkerPoints("10,20 30,40 50,60"), [
    [10, 20],
    [30, 40],
    [50, 60],
  ]);
});

test("decimals, negative coordinates, and surrounding whitespace are accepted", () => {
  assert.deepEqual(parseMarkerPoints("  -1.5,2 3.25,-4.5  "), [
    [-1.5, 2],
    [3.25, -4.5],
  ]);
});

test("extra and repeated internal whitespace is tolerated but not required", () => {
  assert.deepEqual(parseMarkerPoints("1,2\t3,4\n\n5,6  7,8"), [
    [1, 2],
    [3, 4],
    [5, 6],
    [7, 8],
  ]);
});

test("null, undefined, and empty/whitespace-only input all mean 'no points'", () => {
  assert.equal(parseMarkerPoints(null), null);
  assert.equal(parseMarkerPoints(undefined), null);
  assert.equal(parseMarkerPoints(""), null);
  assert.equal(parseMarkerPoints("   \n "), null);
});

test("a token missing its y coordinate is rejected", () => {
  assert.equal(parseMarkerPoints("1,2 3"), null);
});

test("a token with an extra comma is rejected", () => {
  assert.equal(parseMarkerPoints("1,2,3 4,5"), null);
});

test("non-numeric, exponential, and bare-dot coordinates are rejected", () => {
  assert.equal(parseMarkerPoints("a,b 1,2"), null);
  assert.equal(parseMarkerPoints("1e2,3 4,5"), null);
  assert.equal(parseMarkerPoints("NaN,1 2,3"), null);
  assert.equal(parseMarkerPoints(".5,1 2,3"), null);
  assert.equal(parseMarkerPoints("1. 2,3"), null);
  assert.equal(parseMarkerPoints("1 ,2 3,4"), null); // inner space inside a token
});

test("more than MAX_MARKER_POINTS vertices is rejected", () => {
  const tooMany = Array.from({ length: MAX_MARKER_POINTS + 1 }, (_, i) => `${i},0`).join(" ");
  assert.equal(parseMarkerPoints(tooMany), null);
});

test("exactly MAX_MARKER_POINTS vertices is accepted", () => {
  const justRight = Array.from({ length: MAX_MARKER_POINTS }, (_, i) => `${i},0`).join(" ");
  assert.equal(parseMarkerPoints(justRight)?.length, MAX_MARKER_POINTS);
});

test("isWellFormedPoints mirrors parseMarkerPoints' verdict", () => {
  assert.equal(isWellFormedPoints("1,2"), true);
  assert.equal(isWellFormedPoints(""), false);
  assert.equal(isWellFormedPoints("garbage"), false);
});

test("formatMarkerPoints round-trips through parseMarkerPoints", () => {
  const points: [number, number][] = [
    [10, 20],
    [-3.14159, 7.00001],
    [100, 0],
  ];
  const raw = formatMarkerPoints(points);
  assert.equal(raw, "10,20 -3.14,7 100,0");
  const reparsed = parseMarkerPoints(raw);
  assert.ok(reparsed !== null);
  assert.equal(reparsed.length, 3);
  for (let i = 0; i < points.length; i++) {
    const vertex = reparsed[i]!;
    const expected = points[i]!;
    assert.ok(Math.abs(vertex[0] - expected[0]) < 0.01);
    assert.ok(Math.abs(vertex[1] - expected[1]) < 0.01);
  }
});
