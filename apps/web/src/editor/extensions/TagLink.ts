import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent, MarkdownParseHelpers, MarkdownToken } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TagLinkView } from "./TagLinkView.tsx";

interface TagLinkAttrs {
  name: string;
}

/**
 * `#tagname` — an inline atom, mirroring `apps/server/src/lib/tags.ts`'s
 * regex exactly (`/(?<![#\w])#([\w][\w-]*)/`) so the server's tag indexer
 * needs no changes at all: whatever this node round-trips to is what
 * `reindexTags()` already knows how to parse. No label variant, unlike
 * wikilinks — a tag's own name is always its display text.
 */
export const TagLink = Node.create({
  name: "tagLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-tag") ?? "",
        renderHTML: (attrs) => ({ "data-tag": attrs.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-taglink]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-taglink": "" }), `#${HTMLAttributes["data-tag"] ?? ""}`];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TagLinkView);
  },

  // ---------------------------------------------------------------------
  // Markdown round-trip. See apps/server/src/lib/tags.ts — this must stay
  // byte-compatible with that regex, not with any general-purpose markdown
  // convention (so a plain `#word` typed and left alone, never picked from
  // the suggestion popup, still gets indexed the same way on save).
  // ---------------------------------------------------------------------
  markdownTokenizer: {
    name: "tagLink",
    level: "inline",
    start(src: string) {
      const i = src.indexOf("#");
      return i === -1 ? -1 : i;
    },
    tokenize(src: string) {
      // No lookbehind here for the same reason WikiLink.ts's own tokenizer
      // has none: `tokenize()` only ever sees what's ahead of the match, not
      // what came before it, so "not preceded by # or a word character"
      // can't be checked from here. That's fine — the server's tags.ts does
      // have that check and is what actually decides real tag associations
      // on save; the very rare case this renders a live chip for something
      // like "word#tag" (which the server would still correctly treat as
      // plain text) is cosmetic, not a data-correctness issue.
      const match = /^#([\w][\w-]*)/.exec(src);
      if (match === null) return undefined;
      const name = match[1] ?? "";
      if (name.length === 0) return undefined;
      return { type: "tagLink", raw: match[0], name };
    },
  },

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    const attrs: TagLinkAttrs = { name: (token.name as string) ?? "" };
    return helpers.createNode("tagLink", attrs, []);
  },

  renderMarkdown(node: JSONContent) {
    const attrs = node.attrs as TagLinkAttrs | undefined;
    return `#${attrs?.name ?? ""}`;
  },
});
