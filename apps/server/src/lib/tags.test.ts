import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTags } from "./tags.ts";

test("parses hashtags with no space after the #", () => {
  assert.deepEqual(parseTags("Fought the #goblin-warband near #Sourwood."), ["goblin-warband", "sourwood"]);
});

test("a markdown heading is not a tag", () => {
  assert.deepEqual(parseTags("# Chapter One\n\n## A subheading\n\nNo tags here."), []);
});

test("ignores tags inside fenced and inline code", () => {
  const md = ["`#inline`", "", "```", "#fenced", "```", "", "#real"].join("\n");
  assert.deepEqual(parseTags(md), ["real"]);
});

test("deduplicates case-insensitively, keeping first-seen casing normalized", () => {
  assert.deepEqual(parseTags("#Goblin fought another #goblin"), ["goblin"]);
});

test("a bare # or a # touching another word is not a tag", () => {
  assert.deepEqual(parseTags("just a # by itself, and text#3, and ##double"), []);
});
