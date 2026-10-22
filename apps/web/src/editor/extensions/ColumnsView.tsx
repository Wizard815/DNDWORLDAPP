import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { COLUMN_LAYOUTS } from "./Columns.ts";
import type { ColumnLayout } from "./Columns.ts";

const LAYOUT_ICON: Record<ColumnLayout, string> = {
  "1-1": "▥",
  "1-1-1": "▦",
  "1-2": "◧",
  "2-1": "◨",
};

/**
 * A small, always-visible (contentEditable={false}) toolbar above the
 * columns grid — the only way to change layout or get back out, since
 * neither exists as plain prose a writer could type. "Remove" mirrors
 * SecretBlockView's "Reveal": splice the columns' own content back into the
 * surrounding document in place, so removing the layout never silently
 * throws away what was written inside it.
 */
export function ColumnsView({ editor, node, getPos }: NodeViewProps) {
  const layout = (node.attrs.layout as ColumnLayout | undefined) ?? "1-1";

  function columnContents(): JSONContent[][] {
    const columns = node.content.toJSON() as JSONContent[] | null;
    return (columns ?? []).map((column) => (column.content as JSONContent[] | undefined) ?? []);
  }

  function replace(content: JSONContent | JSONContent[]): void {
    const pos = getPos();
    if (pos === undefined) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, content)
      .run();
  }

  function switchLayout(next: ColumnLayout): void {
    if (next === layout) return;
    const targetCount = COLUMN_LAYOUTS[next].columns;
    const current = columnContents();
    let columns = current.map((content) => ({ type: "column", content: content.length > 0 ? content : [{ type: "paragraph" }] }));

    if (columns.length < targetCount) {
      while (columns.length < targetCount) columns.push({ type: "column", content: [{ type: "paragraph" }] });
    } else if (columns.length > targetCount) {
      // Don't silently drop a column's writing — fold whatever's beyond the
      // new count into the last column that survives.
      const kept = columns.slice(0, targetCount - 1);
      const overflow = columns.slice(targetCount - 1).flatMap((c) => c.content);
      kept.push({ type: "column", content: overflow.length > 0 ? overflow : [{ type: "paragraph" }] });
      columns = kept;
    }

    replace({ type: "columns", attrs: { layout: next }, content: columns });
  }

  function removeColumns(): void {
    const flat = columnContents().flat();
    replace(flat.length > 0 ? flat : [{ type: "paragraph" }]);
  }

  return (
    <NodeViewWrapper data-columns-wrapper="">
      <div
        contentEditable={false}
        className="mb-1.5 flex items-center gap-1 text-[10px] text-fg-muted"
      >
        <span className="mr-1">Columns</span>
        {(Object.keys(COLUMN_LAYOUTS) as ColumnLayout[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => switchLayout(key)}
            title={COLUMN_LAYOUTS[key].label}
            className={`rounded border px-1.5 py-0.5 ${
              key === layout
                ? "border-line-strong bg-highlight text-fg"
                : "border-line text-fg-muted hover:text-fg"
            }`}
          >
            {LAYOUT_ICON[key]}
          </button>
        ))}
        <button
          type="button"
          onClick={removeColumns}
          title="Remove the column layout — keeps everything written inside it"
          className="ml-1 rounded border border-line px-1.5 py-0.5 text-danger-soft hover:border-danger-line hover:text-danger"
        >
          ✕ Remove
        </button>
      </div>
      <NodeViewContent data-columns="" data-layout={layout} />
    </NodeViewWrapper>
  );
}
