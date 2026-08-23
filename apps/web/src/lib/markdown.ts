import DOMPurify from "dompurify";
import { marked } from "marked";
import type { NodeSummary } from "@dndworldapp/schema";
import { splitSecretBlocks } from "./secrets.ts";

const WIKILINK = /\[\[([^[\]|]+?)(?:\|([^[\]]*?))?\]\]/g;
const FENCED_CODE = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`\n]*`/g;

/**
 * Blank out code so `[[not a link]]` inside a snippet stays inert, while keeping
 * the string the same length (offsets stay aligned with the original text).
 * Mirrors apps/server/src/lib/wikilinks.ts so the two never disagree about what
 * counts as a wikilink.
 */
function maskCode(md: string): string {
  return md
    .replace(FENCED_CODE, (m) => " ".repeat(m.length))
    .replace(INLINE_CODE, (m) => " ".repeat(m.length));
}

/**
 * Rewrites `[[Target|label]]` into a link before markdown parsing.
 * Unresolved targets render as a distinct "missing page" link, so a wiki link to
 * something you have not written yet reads as a to-do rather than a broken link.
 * Matches are found against a code-masked copy of `md` so links inside fenced or
 * inline code are left untouched; the mask preserves offsets, so captured text
 * outside code is identical between the masked and original strings.
 */
function renderWikilinks(md: string, index: Map<string, NodeSummary>): string {
  const masked = maskCode(md);
  let result = "";
  let lastIndex = 0;

  for (const match of masked.matchAll(WIKILINK)) {
    const start = match.index;
    const end = start + match[0].length;
    result += md.slice(lastIndex, start);

    const rawTarget = match[1] ?? "";
    const rawLabel = match[2];
    const target = rawTarget.trim();
    const label = rawLabel !== undefined && rawLabel.trim().length > 0 ? rawLabel.trim() : target;
    const hit = index.get(target.toLowerCase());
    result +=
      hit === undefined
        ? `<a class="wikilink wikilink-missing" data-missing="${escapeAttr(target)}" href="#">${escapeHtml(label)}</a>`
        : `<a class="wikilink" href="/n/${hit.id}" data-node="${hit.id}">${escapeHtml(label)}</a>`;

    lastIndex = end;
  }

  result += md.slice(lastIndex);
  return result;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c] ?? c;
  });
}

const escapeAttr = escapeHtml;

/**
 * Search snippets are page text with `<mark>` wrapped around the hit, so they are
 * user-authored HTML and must be sanitized before rendering.
 */
export function sanitizeSnippet(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: [] });
}

/**
 * A body a non-DM viewer receives has already had its `:::secret` blocks
 * stripped server-side (see apps/server/src/lib/secrets.ts) — there is nothing
 * for this function to hide. When a DM's client does receive one, it renders
 * with the "Secret" wrapper below rather than as plain prose, so it stays
 * visually distinct from what a player would see on the same page.
 */
export function renderMarkdown(md: string, nodes: NodeSummary[]): string {
  const index = new Map<string, NodeSummary>();
  for (const node of nodes) {
    index.set(node.title.toLowerCase(), node);
    index.set(node.slug.toLowerCase(), node);
  }

  const renderSegment = (segmentMd: string): string => {
    const html = marked.parse(renderWikilinks(segmentMd, index), { async: false, breaks: true });
    return DOMPurify.sanitize(html, { ADD_ATTR: ["data-node", "data-missing", "target"] }) as string;
  };

  return splitSecretBlocks(md)
    .map((segment) =>
      segment.kind === "text"
        ? renderSegment(segment.md)
        : `<div class="secret-block"><div class="secret-block-label">🔒 Secret — DM only</div>${renderSegment(segment.md)}</div>`,
    )
    .join("");
}
