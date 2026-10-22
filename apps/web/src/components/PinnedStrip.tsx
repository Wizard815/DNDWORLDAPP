import type { NodeSummary } from "@dndworldapp/schema";
import { nodeGlyph } from "../lib/kinds.ts";
import { navigate } from "../lib/nav.ts";

/**
 * A row of quick-access chips for manually pinned pages, shown at the top of the
 * whole app (not just the sidebar) so it stays visible regardless of which panel
 * has focus — same idea as a browser's own pinned-tabs strip. Pins are toggled from
 * a page's own "⋯" menu or a sidebar row's context menu, and persisted client-side
 * only (see App.tsx's usePinned) — this is a personal view preference, not
 * campaign content, the same reasoning Sidebar.tsx's expand/collapse state uses.
 */
export function PinnedStrip({
  nodes,
  pinnedIds,
  activeId,
  onUnpin,
}: {
  nodes: NodeSummary[];
  pinnedIds: Set<string>;
  activeId: string | null;
  onUnpin: (nodeId: string) => void;
}) {
  const pinned = nodes.filter((n) => pinnedIds.has(n.id));
  if (pinned.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-divider bg-panel px-2 py-1">
      {pinned.map((node) => (
        <div
          key={node.id}
          className={`group flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs ${
            node.id === activeId ? "bg-selected text-fg-strong" : "text-fg-soft hover:bg-hover"
          }`}
        >
          <button type="button" onClick={() => navigate(`/n/${node.id}`)} className="flex items-center gap-1">
            <span>{nodeGlyph(node)}</span>
            <span className="max-w-[140px] truncate">{node.title}</span>
          </button>
          <button
            type="button"
            onClick={() => onUnpin(node.id)}
            className="hidden text-fg-muted hover:text-danger group-hover:block"
            title="Unpin"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
