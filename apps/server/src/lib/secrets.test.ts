import assert from "node:assert/strict";
import { test } from "node:test";
import { canReadSecretLevel, containsHiddenSecret, containsSecret, redactForViewer, splitSecretBlocks, stripSecrets } from "./secrets.ts";

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
    { kind: "secret", md: "The mayor is the cult leader.", level: "dm", open: ":::secret" },
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
  assert.equal(redactForViewer(md, "dm"), md);
  assert.equal(redactForViewer(md, "owner"), md);
  assert.equal(redactForViewer(md, "player").includes("Hidden."), false);
  assert.equal(redactForViewer(md, null).includes("Hidden."), false);
});

test("a block can be opened to players or to everyone", () => {
  const md = ["Public.", ':::secret {visibility="members"}', "For the party.", ":::", ':::secret {visibility="public"}', "A box for all.", ":::"].join("\n");
  assert.equal(redactForViewer(md, "player"), md);
  const guestView = redactForViewer(md, "guest");
  assert.equal(guestView.includes("For the party."), false);
  assert.equal(guestView.includes("A box for all."), true);
  assert.equal(guestView.includes(':::secret {visibility="public"}'), true, "a kept block keeps its fence so the editor still shows a block");
  assert.equal(redactForViewer(md, null).includes("For the party."), false);
  assert.equal(canReadSecretLevel("members", "guest"), false);
  assert.equal(canReadSecretLevel("public", null), true);
});

test("stripSecrets keeps only public blocks, and containsHiddenSecret is per viewer", () => {
  const md = [":::secret", "dm only", ":::", ':::secret {visibility="members"}', "party", ":::", ':::secret {visibility="public"}', "all", ":::"].join("\n");
  const stripped = stripSecrets(md);
  assert.equal(stripped.includes("dm only"), false);
  assert.equal(stripped.includes("party"), false);
  assert.equal(stripped.includes("all"), true);
  assert.equal(containsHiddenSecret(md, "dm"), false);
  assert.equal(containsHiddenSecret(md, "player"), true);
  assert.equal(containsHiddenSecret(':::secret {visibility="members"}\nx\n:::', "player"), false);
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
    { kind: "secret", md: "Forgot to close this.", level: "dm", open: ":::secret" },
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
