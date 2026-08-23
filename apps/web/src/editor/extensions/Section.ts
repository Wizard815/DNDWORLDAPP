import { Node, createAtomBlockMarkdownSpec, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { SectionView } from "./SectionView.tsx";

/**
 * An inline embedded reference to a `posts` row — what `/section` and
 * `/dm-notes` insert. Deliberately NOT a container for the post's body: the
 * post stays exactly where it always lived (its own row, its own visibility,
 * the same API), this node is only a placeholder marking *where in the page*
 * it renders. Serializes to a single-line atom fence
 * (`:::post {postId="..."} :::`) via `createAtomBlockMarkdownSpec` — the
 * server never needs to understand this syntax; it's opaque body text to it,
 * same as `:::secret` already is (see docs/HANDOFF.md on the editor).
 */
const markdownSpec = createAtomBlockMarkdownSpec({
  nodeName: "postSection",
  name: "post",
  requiredAttributes: ["postId"],
  allowedAttributes: ["postId"],
});

export const Section = Node.create({
  name: "postSection",
  group: "block",
  atom: true,
  selectable: true,

  ...markdownSpec,

  addAttributes() {
    return {
      postId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-post-id"),
        renderHTML: (attrs) => (attrs.postId ? { "data-post-id": attrs.postId } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-post-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SectionView);
  },
});
