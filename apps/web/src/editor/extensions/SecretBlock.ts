import { Node, createBlockMarkdownSpec, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { SecretBlockView } from "./SecretBlockView.tsx";

/**
 * `:::secret ... :::` as a native, editable-in-place block instead of a raw
 * text scaffold in a textarea. `createBlockMarkdownSpec` (native to
 * `@tiptap/core` v3.30+) renders it as `:::secret\n\n<content>\n\n:::` — no
 * attributes, so no `{...}` suffix — which is still exactly what
 * `apps/server/src/lib/secrets.ts::splitSecretBlocks` expects: it parses
 * line by line, and blank lines immediately inside the fence are harmless
 * (they just become an empty line in the redacted/kept segment either way).
 */
const markdownSpec = createBlockMarkdownSpec({
  nodeName: "secretBlock",
  name: "secret",
  defaultAttributes: { visibility: "dm" },
  allowedAttributes: ["visibility"],
});

export const SecretBlock = Node.create({
  name: "secretBlock",
  group: "block",
  content: "block+",
  defining: true,

  ...markdownSpec,

  addAttributes() {
    return {
      /** Who may read it: "dm" (default), "members", or "public" — see apps/server/src/lib/secrets.ts. */
      visibility: {
        default: "dm",
        parseHTML: (element) => element.getAttribute("data-visibility") ?? "dm",
        renderHTML: (attributes) => ({ "data-visibility": attributes.visibility as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-secret-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-secret-block": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SecretBlockView);
  },
});
