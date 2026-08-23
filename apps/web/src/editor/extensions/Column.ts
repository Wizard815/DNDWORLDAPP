import { Node, createBlockMarkdownSpec, mergeAttributes } from "@tiptap/core";

/** One side of a `/layout` columns block — arbitrary rich content, only valid inside `columns`. */
const markdownSpec = createBlockMarkdownSpec({ nodeName: "column" });

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,

  ...markdownSpec,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "" }), 0];
  },
});
