import { useState, useMemo } from "react";
import type { NodeSummary } from "@dndworldapp/schema";

interface TreeViewProps {
  nodes: NodeSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}

export function TreeView({ nodes, selectedId, onSelect, depth = 0 }: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Group nodes by parent
  const byParent = useMemo(() => {
    const map = new Map<string | null, NodeSummary[]>();
    for (const node of nodes) {
      const list = map.get(node.parentId) ?? [];
      list.push(node);
      map.set(node.parentId, list);
    }
    return map;
  }, [nodes]);

  // Sort by sortKey
  const sorted = (parentId: string | null) => {
    const list = byParent.get(parentId) ?? [];
    return [...list].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
  };

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: NodeSummary) {
    const hasChildren = byParent.has(node.id);
    const isExpanded = expanded.has(node.id);
    const isSelected = selectedId === node.id;

    // Visibility badge
    const visibilityColor =
      node.visibility === "dm" ? "text-yellow-400" :
      node.visibility === "private" ? "text-red-400" :
      node.visibility === "members" ? "text-blue-400" :
      "text-green-400";

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-1 py-1 px-2 rounded cursor-pointer text-sm ${
            isSelected ? "bg-blue-900/50 text-blue-300" : "hover:bg-gray-700/50 text-gray-300"
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onSelect(node.id)}
        >
          {/* Expand/collapse toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(node.id);
            }}
            className="w-4 h-4 flex items-center justify-center text-gray-500 hover:text-gray-300"
          >
            {hasChildren ? (isExpanded ? "▼" : "▶") : "•"}
          </button>

          {/* Kind icon */}
          <span className="text-xs uppercase tracking-wide text-gray-500 w-16 shrink-0">
            {node.kind === "document" ? "DOC" : node.kind}
          </span>

          {/* Title */}
          <span className="truncate">{node.title}</span>

          {/* Visibility badge */}
          <span className={`ml-auto text-xs ${visibilityColor} shrink-0`}>
            {node.visibility.slice(0, 2)}
          </span>
        </div>

        {/* Children */}
        {isExpanded && hasChildren && (
          <div>
            {sorted(node.id).map((child) => renderNode(child))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {sorted(null).map((node) => renderNode(node))}
    </div>
  );
}
