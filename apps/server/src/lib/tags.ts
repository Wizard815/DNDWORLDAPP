const FENCED_CODE = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`\n]*`/g;
// `#word` with no preceding `#` or word character (so `##Heading` and a
// literal `text#3` stay inert) and no space right after the `#` (so
// `# Heading` — a markdown heading, always has one — never counts as a tag).
const TAG = /(?<![#\w])#([\w][\w-]*)/g;

/**
 * Blank out code so `#not-a-tag` inside a snippet stays inert, while keeping
 * the string the same length (offsets stay usable if we ever need them).
 * Duplicated from wikilinks.ts rather than shared — two call sites, and a
 * shared helper would need its own module just for this.
 */
function maskCode(md: string): string {
  return md
    .replace(FENCED_CODE, (m) => " ".repeat(m.length))
    .replace(INLINE_CODE, (m) => " ".repeat(m.length));
}

/** Every distinct `#tag` in the body, lowercased and de-duplicated, in first-seen order. */
export function parseTags(md: string): string[] {
  const masked = maskCode(md);
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const match of masked.matchAll(TAG)) {
    const tag = tagKey(match[1] ?? "");
    if (tag.length === 0 || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }

  return tags;
}

/** Normalised form used to match a tag against a tag node's title. */
export function tagKey(text: string): string {
  return text.trim().toLowerCase();
}
