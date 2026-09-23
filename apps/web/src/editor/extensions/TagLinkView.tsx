import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { navigate } from "../../lib/nav.ts";
import { useEditorPage } from "../context.tsx";

/**
 * `#tagname` rendered live, as a small pill rather than raw hash-prefixed
 * text — same resolved/not-yet-saved distinction WikiLinkView draws, except
 * there is no "click to create": a tag always resolves once the page saves
 * (reindexTags() creates it then), so an unresolved chip just says so rather
 * than offering an action with nowhere to go yet.
 */
export function TagLinkView({ node }: NodeViewProps) {
  const { allNodes } = useEditorPage();
  const name = ((node.attrs.name as string) ?? "").toLowerCase();
  const hit = allNodes.find((n) => n.kind === "tag" && n.title.toLowerCase() === name);

  return (
    <NodeViewWrapper as="span" className="inline">
      {hit !== undefined ? (
        <a
          href={`/n/${hit.id}`}
          className="tag-chip"
          onClick={(e) => {
            e.preventDefault();
            navigate(`/n/${hit.id}`);
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
