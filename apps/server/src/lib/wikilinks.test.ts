import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWikilinks } from "./wikilinks.ts";

test("parses plain and labelled links", () => {
  const links = parseWikilinks("See [[Captain Daigo]] and [[Gray Hunters|the Hunters]].");
  assert.deepEqual(links, [
    { target: "Captain Daigo", label: null },
    { target: "Gray Hunters", label: "the Hunters" },
  ]);
});

test("ignores links inside fenced and inline code", () => {
  const md = ["`[[inline]]`", "", "```", "[[fenced]]", "```", "", "[[real]]"].join("\n");
  assert.deepEqual(parseWikilinks(md), [{ target: "real", label: null }]);
});

test("deduplicates identical targets", () => {
  const links = parseWikilinks("[[Ciridan]] [[ciridan]] [[Ciridan|map]]");
  assert.deepEqual(links, [
    { target: "Ciridan", label: null },
    { target: "Ciridan", label: "map" },
  ]);
});

test("skips empty and malformed brackets", () => {
  assert.deepEqual(parseWikilinks("[[]] [[   ]] [not a link] [[a]]"), [
    { target: "a", label: null },
  ]);
});
