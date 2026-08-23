import { Node, createBlockMarkdownSpec, mergeAttributes } from "@tiptap/core";

/**
 * `/layout` — two side-by-side columns. Serializes to nested
 * `:::columns` / `:::column` / `:::` fences via `createBlockMarkdownSpec`;
 * its generic `:::`-nesting tracker (shared with SecretBlock and Section)
 * handles the nesting correctly, and the server never needs to parse any of
 * it — additive markdown syntax, opaque body text either way.
 */
const markdownSpec = createBlockMarkdownSpec({ nodeName: "columns" });

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column column",
  isolating: true,

  ...markdownSpec,

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "" }), 0];
  },
});
