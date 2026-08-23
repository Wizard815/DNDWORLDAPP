import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";

/** Same gold "Secret" wrapper the old renderer used — see styles.css `.secret-block`. */
export function SecretBlockView() {
  return (
    <NodeViewWrapper className="secret-block">
      <div className="secret-block-label" contentEditable={false}>
        🔒 Secret — DM only
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
