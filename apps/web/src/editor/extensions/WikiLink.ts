import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent, MarkdownParseHelpers, MarkdownToken } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { WikiLinkView } from "./WikiLinkView.tsx";

interface WikiLinkAttrs {
  target: string;
  label: string | null;
}

/**
 * `[[Target]]` / `[[Target|Label]]` — an inline atom, mirroring
 * `apps/server/src/lib/wikilinks.ts`'s regex exactly
 * (`/\[\[([^[\]|]+?)(?:\|([^[\]]*?))?\]\]/`) so the server's link resolver,
 * backlinks and unresolved-link tracking need no changes at all: whatever
 * this node round-trips to is indistinguishable from what the old textarea
 * produced.
 *
 * "Resolved or not" is deliberately NOT a stored attribute — a target page
 * can be created or archived after this link was written, so resolution is
 * computed live at render time (see WikiLinkView) against whatever `allNodes`
 * currently holds, the same way the server and the old renderMarkdown() both
 * already treat it.
 */
export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-target") ?? "",
        renderHTML: (attrs) => ({ "data-target": attrs.target }),
      },
      label: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-label"),
        renderHTML: (attrs) => (attrs.label ? { "data-label": attrs.label } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wikilink]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-wikilink": "" }),
      HTMLAttributes["data-label"] ?? HTMLAttributes["data-target"] ?? "",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WikiLinkView);
  },

  // ---------------------------------------------------------------------
  // Markdown round-trip. See apps/server/src/lib/wikilinks.ts — this must
  // stay byte-compatible with that regex, not with any general-purpose
  // markdown convention.
  // ---------------------------------------------------------------------
  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start(src: string) {
      const i = src.indexOf("[[");
      return i === -1 ? -1 : i;
    },
    tokenize(src: string) {
      const match = /^\[\[([^[\]|]+?)(?:\|([^[\]]*?))?\]\]/.exec(src);
      if (match === null) return undefined;
      const target = (match[1] ?? "").trim();
      if (target.length === 0) return undefined;
      const rawLabel = match[2];
      const label = rawLabel !== undefined && rawLabel.trim().length > 0 ? rawLabel.trim() : null;
      return { type: "wikiLink", raw: match[0], target, label };
    },
  },

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    const attrs: WikiLinkAttrs = { target: (token.target as string) ?? "", label: (token.label as string | null) ?? null };
    return helpers.createNode("wikiLink", attrs, []);
  },

  renderMarkdown(node: JSONContent) {
    const attrs = node.attrs as WikiLinkAttrs | undefined;
    const target = attrs?.target ?? "";
    const label = attrs?.label;
    return label ? `[[${target}|${label}]]` : `[[${target}]]`;
  },
});
