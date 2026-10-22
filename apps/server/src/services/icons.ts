import { createRequire } from "node:module";
import { parseIconRef, type IconHit, type IconSet } from "@dndworldapp/schema";
import { badRequest } from "../lib/errors.ts";

/**
 * The bundled icon library: two Iconify JSON collections, read once on first
 * use and kept in memory (~7 MB of JSON, ~5,500 icons). Clients never download
 * the collections — they search here and fetch one SVG per icon actually shown.
 */
interface IconifyIcon {
  body: string;
  width?: number;
  height?: number;
}
interface IconifyCollection {
  icons: Record<string, IconifyIcon>;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
}

const require = createRequire(import.meta.url);
const PACKAGES: Record<IconSet, string> = {
  "game-icons": "@iconify-json/game-icons/icons.json",
  "fa6-solid": "@iconify-json/fa6-solid/icons.json",
};

let collections: Map<IconSet, IconifyCollection> | null = null;
let index: IconHit[] | null = null;

function load(): { collections: Map<IconSet, IconifyCollection>; index: IconHit[] } {
  if (collections === null || index === null) {
    collections = new Map();
    index = [];
    for (const [set, pkg] of Object.entries(PACKAGES) as [IconSet, string][]) {
      const collection = require(pkg) as IconifyCollection;
      collections.set(set, collection);
      for (const name of Object.keys(collection.icons)) index.push({ ref: `${set}:${name}`, set, name });
    }
    index.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { collections, index };
}

/**
 * Every query word must appear in the icon's name. Ranked: exact name, then
 * names containing each query word as a whole word, then a name that starts
 * with the query, then words that merely start with a query word, then any
 * substring; shorter names first within a rank, so "sword-hilt" beats
 * "swordman" and both beat "crossed-swords-in-a-stone" for "sword".
 */
export function searchIcons(q: string, set: IconSet | undefined, limit: number): { icons: IconHit[]; total: number } {
  const { index: all } = load();
  const words = q.toLowerCase().split(/[\s-]+/).filter((w) => w.length > 0);
  const query = words.join("-");

  const scored: { hit: IconHit; score: number }[] = [];
  for (const hit of all) {
    if (set !== undefined && hit.set !== set) continue;
    if (!words.every((w) => hit.name.includes(w))) continue;
    const parts = hit.name.split("-");
    let score = 4;
    if (words.length === 0 || hit.name === query) score = 0;
    else if (words.every((w) => parts.includes(w))) score = 1;
    else if (hit.name.startsWith(query)) score = 2;
    else if (words.every((w) => parts.some((part) => part.startsWith(w)))) score = 3;
    scored.push({ hit, score });
  }
  if (words.length > 0) {
    scored.sort((a, b) => a.score - b.score || a.hit.name.length - b.hit.name.length || a.hit.name.localeCompare(b.hit.name));
  }
  return { icons: scored.slice(0, limit).map((s) => s.hit), total: scored.length };
}

/** A standalone SVG for one icon, or null when the set/name is unknown. `currentColor` throughout, so CSS can tint it. */
export function iconSvg(set: IconSet, name: string): string | null {
  const collection = load().collections.get(set);
  if (collection === undefined) return null;
  const iconName = collection.icons[name] !== undefined ? name : collection.aliases?.[name]?.parent;
  const icon = iconName !== undefined ? collection.icons[iconName] : undefined;
  if (icon === undefined) return null;
  const width = icon.width ?? collection.width ?? 16;
  const height = icon.height ?? collection.height ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${icon.body}</svg>`;
}

/**
 * Rejects a value that claims a library prefix but names no real icon — the
 * likely mistake is an MCP client guessing a name instead of searching, and a
 * 400 telling it so beats a marker that silently renders blank. Anything
 * without a library prefix is an emoji and passes through untouched.
 */
export function assertKnownIcon(icon: string | null | undefined): void {
  if (icon == null || !/^(game-icons|fa6-solid):/.test(icon)) return;
  const ref = parseIconRef(icon);
  if (ref === null || iconSvg(ref.set, ref.name) === null) {
    throw badRequest(`Unknown library icon "${icon}". Use GET /api/v1/icons?q=… (MCP: search_icons) to find a real one.`);
  }
}
