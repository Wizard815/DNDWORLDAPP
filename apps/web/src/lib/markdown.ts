import DOMPurify from "dompurify";
import { marked } from "marked";
import type { NodeSummary } from "@dndworldapp/schema";

const WIKILINK = /\[\[([^[\]|]+?)(?:\|([^[\]]*?))?\]\]/g;

/**
 * Rewrites `[[Target|label]]` into a link before markdown parsing.
 * Unresolved targets render as a distinct "missing page" link, so a wiki link to
 * something you have not written yet reads as a to-do rather than a broken link.
 */
function renderWikilinks(md: string, index: Map<string, NodeSummary>): string {
  return md.replace(WIKILINK, (_match, rawTarget: string, rawLabel?: string) => {
    const target = rawTarget.trim();
    const label = rawLabel !== undefined && rawLabel.trim().length > 0 ? rawLabel.trim() : target;
    const hit = index.get(target.toLowerCase());
    if (hit === undefined) {
      return `<a class="wikilink wikilink-missing" data-missing="${escapeAttr(target)}" href="#">${escapeHtml(label)}</a>`;
    }
    return `<a class="wikilink" href="/n/${hit.id}" data-node="${hit.id}">${escapeHtml(label)}</a>`;
  });
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

export function renderMarkdown(md: string, nodes: NodeSummary[]): string {
  const index = new Map<string, NodeSummary>();
  for (const node of nodes) {
    index.set(node.title.toLowerCase(), node);
    index.set(node.slug.toLowerCase(), node);
  }
  const html = marked.parse(renderWikilinks(md, index), { async: false, breaks: true });
  return DOMPurify.sanitize(html, { ADD_ATTR: ["data-node", "data-missing", "target"] });
}
