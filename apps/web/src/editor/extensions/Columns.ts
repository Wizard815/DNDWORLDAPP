import { Node, createBlockMarkdownSpec, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ColumnsView } from "./ColumnsView.tsx";

/** Every column layout this editor offers, and how many `column` children each one needs. */
export const COLUMN_LAYOUTS = {
  "1-1": { label: "Two columns", columns: 2 },
  "1-1-1": { label: "Three columns", columns: 3 },
  "1-2": { label: "Narrow + wide", columns: 2 },
  "2-1": { label: "Wide + narrow", columns: 2 },
} as const;
export type ColumnLayout = keyof typeof COLUMN_LAYOUTS;

/**
 * `/layout` — side-by-side columns in one of a few fixed arrangements (see
 * COLUMN_LAYOUTS). Serializes to nested `:::columns{layout="..."}` /
 * `:::column` / `:::` fences via `createBlockMarkdownSpec`; its generic
 * `:::`-nesting tracker (shared with SecretBlock and Section) handles the
 * nesting correctly, and the server never needs to parse any of it —
 * additive markdown syntax, opaque body text either way. `content:
 * "column{2,3}"` covers every layout above (2 or 3 columns); the layout
 * attribute alone decides the width split via styles.css.
 */
const markdownSpec = createBlockMarkdownSpec({
  nodeName: "columns",
  defaultAttributes: { layout: "1-1" },
  allowedAttributes: ["layout"],
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  isolating: true,

  addAttributes() {
    return {
      layout: {
        default: "1-1",
        parseHTML: (element) => element.getAttribute("data-layout") ?? "1-1",
        renderHTML: (attributes) => ({ "data-layout": attributes.layout as string }),
      },
    };
  },

  ...markdownSpec,

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ColumnsView);
  },
});
