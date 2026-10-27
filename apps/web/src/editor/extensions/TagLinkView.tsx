import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { navigate } from "../../lib/nav.ts";
import { useEditorPage } from "../context.tsx";

/**
 * `#tagname` rendered live as a chip in the tag's color. A tag that doesn't
 * exist yet (the page hasn't saved since it was typed) shows as pending —
 * every tag resolves once the page saves, so there's no "create" action.
 */
export function TagLinkView({ node }: NodeViewProps) {
  const { tags } = useEditorPage();
  const name = ((node.attrs.name as string) ?? "").toLowerCase();
  const hit = tags.find((t) => t.name === name);

  return (
    <NodeViewWrapper as="span" className="inline">
      {hit !== undefined ? (
        <a
          href={`/tags/${hit.id}`}
          className="tag-chip"
          data-color={hit.color ?? undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(`/tags/${hit.id}`);
          }}
        >
          #{name}
        </a>
      ) : (
        <span className="tag-chip tag-chip-pending" title="Saved as a tag once this page is saved">
          #{name}
        </span>
      )}
    </NodeViewWrapper>
  );
}
