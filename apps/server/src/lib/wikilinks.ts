export interface ParsedLink {
  /** The text inside the brackets, before any pipe. */
  target: string;
  /** Display text after a pipe, if given. */
  label: string | null;
}

const FENCED_CODE = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`\n]*`/g;
const WIKILINK = /\[\[([^[\]|]+?)(?:\|([^[\]]*?))?\]\]/g;

/**
 * Blank out code so `[[not a link]]` inside a snippet stays inert, while keeping
 * the string the same length (offsets stay usable if we ever need them).
 */
function maskCode(md: string): string {
  return md
    .replace(FENCED_CODE, (m) => " ".repeat(m.length))
    .replace(INLINE_CODE, (m) => " ".repeat(m.length));
}

export function parseWikilinks(md: string): ParsedLink[] {
  const masked = maskCode(md);
  const seen = new Set<string>();
  const links: ParsedLink[] = [];

  for (const match of masked.matchAll(WIKILINK)) {
    const target = (match[1] ?? "").trim();
    if (target.length === 0) continue;
    const rawLabel = match[2];
    const label = rawLabel !== undefined && rawLabel.trim().length > 0 ? rawLabel.trim() : null;
    const dedupeKey = `${target.toLowerCase()}::${label ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    links.push({ target, label });
  }

  return links;
}

/** Normalised form used to match a link target against a node title or slug. */
export function linkKey(text: string): string {
  return text.trim().toLowerCase();
}
