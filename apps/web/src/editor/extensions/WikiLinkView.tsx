import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { navigate } from "../../lib/nav.ts";
import { useEditorPage } from "../context.tsx";

/** `[[Target]]` rendered live — resolved (blue, links) or missing (dashed, offers to create). */
export function WikiLinkView({ node }: NodeViewProps) {
  const { allNodes, onCreateNamed } = useEditorPage();
  const target = (node.attrs.target as string) ?? "";
  const label = (node.attrs.label as string | null) ?? target;
  const key = target.toLowerCase();
  const hit = allNodes.find((n) => n.title.toLowerCase() === key || n.slug.toLowerCase() === key);

  return (
    <NodeViewWrapper as="span" className="inline">
      {hit !== undefined ? (
        <a
          href={`/n/${hit.id}`}
          className="wikilink"
          onClick={(e) => {
            e.preventDefault();
            navigate(`/n/${hit.id}`);
          }}
        >
          {label}
        </a>
      ) : (
        <a
          href="#"
          className="wikilink wikilink-missing"
          onClick={(e) => {
            e.preventDefault();
            onCreateNamed(target);
          }}
        >
          {label}
        </a>
      )}
    </NodeViewWrapper>
  );
}
