import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

/**
 * Same gold "Secret" wrapper the old renderer used — see styles.css
 * `.secret-block`. "Reveal" un-hides it permanently: the block's own content
 * (already live-editable prose, no separate Edit button) gets spliced into
 * the surrounding document in its place, and the wrapper — the only thing
 * that made it a secret — is gone. There is no partial/temporary reveal:
 * this is the same one-way action as changing a page's visibility, just at
 * the paragraph level instead of the whole page.
 */
export function SecretBlockView({ editor, node, getPos }: NodeViewProps) {
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
    <NodeViewWrapper className="secret-block">
      <div className="secret-block-label" contentEditable={false}>
        <span>🔒 Secret — DM only</span>
        <button
          type="button"
          onClick={reveal}
          className="secret-block-reveal"
          title="Remove the secret wrapper — this text becomes normal, visible prose"
        >
          Reveal
        </button>
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
