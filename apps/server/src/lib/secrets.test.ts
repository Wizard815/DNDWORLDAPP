import assert from "node:assert/strict";
import { test } from "node:test";
import { containsSecret, redactForViewer, splitSecretBlocks, stripSecrets } from "./secrets.ts";

test("a body with no secret block is one text segment", () => {
  const md = "Hello.\n\nWorld.";
  assert.deepEqual(splitSecretBlocks(md), [{ kind: "text", md }]);
  assert.equal(stripSecrets(md), md);
  assert.equal(containsSecret(md), false);
});

test("splits text, secret and text around a block", () => {
  const md = ["Public before.", "", ":::secret", "The mayor is the cult leader.", ":::", "", "Public after."].join(
    "\n",
  );
  assert.deepEqual(splitSecretBlocks(md), [
    { kind: "text", md: "Public before.\n" },
    { kind: "secret", md: "The mayor is the cult leader." },
    { kind: "text", md: "\nPublic after." },
  ]);
});

test("stripSecrets removes the block and its fences without a trace", () => {
  const md = ["Before.", ":::secret", "Hidden.", ":::", "After."].join("\n");
  const stripped = stripSecrets(md);
  assert.equal(stripped.includes("Hidden."), false);
  assert.equal(stripped.includes(":::"), false);
  assert.equal(stripped.includes("Before."), true);
  assert.equal(stripped.includes("After."), true);
});

test("redactForViewer returns the full body only when allowed", () => {
  const md = ["Public.", ":::secret", "Hidden.", ":::"].join("\n");
  assert.equal(redactForViewer(md, true), md);
  assert.equal(redactForViewer(md, false).includes("Hidden."), false);
});

test("containsSecret is true even for an empty block", () => {
  const md = [":::secret", ":::"].join("\n");
  assert.equal(containsSecret(md), true);
  assert.equal(stripSecrets(md), "");
});

test("an unterminated block hides everything after it, fail closed", () => {
  const md = ["Public.", ":::secret", "Forgot to close this."].join("\n");
  assert.deepEqual(splitSecretBlocks(md), [
    { kind: "text", md: "Public." },
    { kind: "secret", md: "Forgot to close this." },
  ]);
  assert.equal(stripSecrets(md), "Public.");
});

test("a literal :::secret inside a fenced code block is inert", () => {
  const md = ["Example syntax:", "```", ":::secret", "not actually hidden", ":::", "```", "Still public."].join(
    "\n",
  );
  assert.equal(containsSecret(md), false);
  assert.equal(stripSecrets(md), md);
});

test("a second :::secret before the closing fence is swallowed as plain content", () => {
  const md = [":::secret", "first line", ":::secret", "second line", ":::", "after"].join("\n");
  const segments = splitSecretBlocks(md);
  assert.equal(segments.length, 2);
  assert.equal(segments[0]!.kind, "secret");
  assert.equal(segments[0]!.md, "first line\n:::secret\nsecond line");
  assert.equal(segments[1]!.md, "after");
});

test("multiple separate blocks in one body", () => {
  const md = [":::secret", "one", ":::", "middle", ":::secret", "two", ":::"].join("\n");
  const segments = splitSecretBlocks(md);
  assert.deepEqual(
    segments.map((s) => s.kind),
    ["secret", "text", "secret"],
  );
  assert.equal(segments[0]!.md, "one");
  assert.equal(segments[2]!.md, "two");
});

test("open/close matching is case-insensitive on the open fence, exact on close", () => {
  const md = [":::SECRET", "hidden", ":::"].join("\n");
  assert.equal(containsSecret(md), true);
});
