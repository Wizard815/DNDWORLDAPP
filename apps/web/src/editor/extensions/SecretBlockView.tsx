import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

type SecretLevel = "dm" | "members" | "public";

const LEVEL_LABEL: Record<SecretLevel, string> = {
  dm: "DM only",
  members: "Players",
  public: "Everyone",
};

/**
 * One block, three audiences. The server decides who actually receives the
 * contents (apps/server/src/lib/secrets.ts), this just labels it and lets
 * the author change the level. "Reveal" removes the wrapper for good:
 * the block's own content gets spliced into the surrounding document in
 * its place — the same one-way action as changing a page's visibility,
 * just at the paragraph level.
 */
export function SecretBlockView({ editor, node, getPos, updateAttributes }: NodeViewProps) {
  const level = ((node.attrs.visibility as string | undefined) ?? "dm") as SecretLevel;

  function reveal(): void {
    const pos = getPos();
    if (pos === undefined) return;
    const content = node.content.toJSON() as unknown[];
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, content)
      .run();
  }

  return (
    <NodeViewWrapper className="secret-block" data-level={level}>
      <div className="secret-block-label" contentEditable={false}>
        <span className="flex items-center gap-1.5">
          {level === "public" ? "📣" : level === "members" ? "👥" : "🔒"} Secret —
          <select
            value={level}
            onChange={(e) => updateAttributes({ visibility: e.target.value })}
            title="Who can read this block"
            aria-label="Who can read this block"
            className="secret-block-level"
          >
            {(Object.keys(LEVEL_LABEL) as SecretLevel[]).map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
        </span>
        <button
          type="button"
          onClick={reveal}
          className="secret-block-reveal"
          title="Remove the secret wrapper — this text becomes normal prose"
        >
          Reveal
        </button>
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
