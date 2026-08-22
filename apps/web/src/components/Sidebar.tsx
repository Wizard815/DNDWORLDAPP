import { useEffect, useMemo, useState } from "react";
import type { MoveNodeInput, NodeSummary } from "@dndworldapp/schema";
import { navigate } from "../lib/nav.ts";

const KIND_GLYPH: Record<string, string> = {
  document: "📄",
  map: "🗺️",
  timeline: "🕰️",
  calendar: "📅",
  board: "🗂️",
  view: "🔎",
  tag: "🏷️",
};

type DropMode = "before" | "after" | "into";

interface Props {
  worldName: string;
  nodes: NodeSummary[];
  activeId: string | null;
  onCreate: (parentId: string | null) => void;
  onMove: (nodeId: string, input: MoveNodeInput) => void;
  onOpenSwitcher: () => void;
  onOpenTokens: () => void;
  onOpenMembers: () => void;
  onSignOut: () => void;
}

function useExpanded(worldName: string) {
  const storageKey = `dwa:expanded:${worldName}`;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return new Set<string>(raw !== null ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify([...expanded]));
  }, [expanded, storageKey]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return { expanded, toggle, setExpanded };
}

export function Sidebar({
  worldName,
  nodes,
  activeId,
  onCreate,
  onMove,
  onOpenSwitcher,
  onOpenTokens,
  onOpenMembers,
  onSignOut,
}: Props) {
  const [filter, setFilter] = useState("");
  const { expanded, toggle, setExpanded } = useExpanded(worldName);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; mode: DropMode } | null>(null);

  const byParent = useMemo(() => {
    const map = new Map<string | null, NodeSummary[]>();
    for (const node of nodes) {
      const list = map.get(node.parentId) ?? [];
      list.push(node);
      map.set(node.parentId, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    return map;
  }, [nodes]);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /** When filtering, keep any node that matches or has a matching descendant. */
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return null;
    const keep = new Set<string>();
    for (const node of nodes) {
      if (!node.title.toLowerCase().includes(needle)) continue;
      keep.add(node.id);
      let parent = node.parentId;
      while (parent !== null && !keep.has(parent)) {
        keep.add(parent);
        parent = byId.get(parent)?.parentId ?? null;
      }
    }
    return keep;
  }, [filter, nodes, byId]);

  // Auto-expand while filtering so matches are actually reachable.
  useEffect(() => {
    if (visible !== null) setExpanded(new Set(visible));
  }, [visible, setExpanded]);

  function isAncestor(possibleAncestor: string, nodeId: string): boolean {
    let current = byId.get(nodeId)?.parentId ?? null;
    while (current !== null) {
      if (current === possibleAncestor) return true;
      current = byId.get(current)?.parentId ?? null;
    }
    return false;
  }

  function handleDrop(target: NodeSummary, mode: DropMode): void {
    const sourceId = dragId;
    setDragId(null);
    setDropTarget(null);
    if (sourceId === null || sourceId === target.id) return;
    if (isAncestor(sourceId, target.id)) return; // the server rejects it too

    if (mode === "into") {
      onMove(sourceId, { parentId: target.id });
      setExpanded((prev) => new Set(prev).add(target.id));
      return;
    }

    const siblings = (byParent.get(target.parentId) ?? []).filter((n) => n.id !== sourceId);
    const index = siblings.findIndex((n) => n.id === target.id);
    if (mode === "before") {
      onMove(sourceId, {
        parentId: target.parentId,
        afterId: siblings[index - 1]?.id ?? null,
        beforeId: target.id,
      });
    } else {
      onMove(sourceId, {
        parentId: target.parentId,
        afterId: target.id,
        beforeId: siblings[index + 1]?.id ?? null,
      });
    }
  }

  function renderRow(node: NodeSummary, depth: number) {
    if (visible !== null && !visible.has(node.id)) return null;
    const children = byParent.get(node.id) ?? [];
    const isOpen = expanded.has(node.id);
    const isActive = node.id === activeId;
    const drop = dropTarget?.id === node.id ? dropTarget.mode : null;

    return (
      <div key={node.id}>
        <div
          draggable
          onDragStart={(e) => {
            setDragId(node.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropTarget(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const offset = (e.clientY - rect.top) / rect.height;
            const mode: DropMode = offset < 0.25 ? "before" : offset > 0.75 ? "after" : "into";
            setDropTarget({ id: node.id, mode });
          }}
          onDragLeave={() => setDropTarget((prev) => (prev?.id === node.id ? null : prev))}
          onDrop={(e) => {
            e.preventDefault();
            handleDrop(node, drop ?? "into");
          }}
          onClick={() => navigate(`/n/${node.id}`)}
          className={[
            "group flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-sm",
            isActive ? "bg-[#2c2f36] text-[#f0f1f4]" : "text-[#b6b8bf] hover:bg-[#232529]",
            drop === "into" ? "drop-into" : "",
            drop === "before" ? "drop-before" : "",
            drop === "after" ? "drop-after" : "",
          ].join(" ")}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle(node.id);
            }}
            className={`w-3 shrink-0 text-[10px] text-[#7a7d86] ${children.length === 0 ? "invisible" : ""}`}
            aria-label={isOpen ? `Collapse ${node.title}` : `Expand ${node.title}`}
          >
            {isOpen ? "▾" : "▸"}
          </button>
          <span className="shrink-0 text-xs">{node.icon ?? KIND_GLYPH[node.kind] ?? "📄"}</span>
          <span className="truncate">{node.title}</span>
          {node.visibility === "dm" && (
            <span className="ml-auto shrink-0 text-[10px] text-[#c9a227]" title="DM only">
              ●
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCreate(node.id);
            }}
            className="ml-1 hidden shrink-0 px-1 text-[#7a7d86] hover:text-[#d7d8dc] group-hover:block"
            title="New child page"
          >
            +
          </button>
        </div>
        {isOpen && children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  }

  const roots = byParent.get(null) ?? [];

  return (
    <aside className="flex h-screen w-[290px] shrink-0 flex-col border-r border-[#26282d] bg-[#1a1c20]">
      <div className="flex items-center gap-2 px-3 py-3">
        <span className="truncate text-sm font-semibold text-[#f0f1f4]">{worldName}</span>
        <button
          type="button"
          onClick={onOpenSwitcher}
          className="ml-auto rounded border border-[#33363d] px-1.5 py-0.5 text-[10px] text-[#8d9099] hover:text-[#d7d8dc]"
          title="Search (Ctrl+K)"
        >
          Ctrl K
        </button>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find by name"
        className="mx-3 mb-2 rounded-md border border-[#2c2f36] bg-[#1d1f23] px-2 py-1.5 text-xs outline-none focus:border-[#4a4d55]"
      />

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {roots.map((node) => renderRow(node, 0))}
        {roots.length === 0 && (
          <p className="px-2 py-4 text-xs text-[#7a7d86]">Nothing here yet.</p>
        )}
      </div>

      <div className="border-t border-[#26282d] p-2">
        <button
          type="button"
          onClick={() => onCreate(null)}
          className="w-full rounded px-2 py-1.5 text-left text-xs text-[#8d9099] hover:bg-[#232529] hover:text-[#d7d8dc]"
        >
          + New top-level page
        </button>
        <button
          type="button"
          onClick={onOpenMembers}
          className="w-full rounded px-2 py-1.5 text-left text-xs text-[#7a7d86] hover:bg-[#232529] hover:text-[#d7d8dc]"
        >
          Members
        </button>
        <button
          type="button"
          onClick={onOpenTokens}
          className="w-full rounded px-2 py-1.5 text-left text-xs text-[#7a7d86] hover:bg-[#232529] hover:text-[#d7d8dc]"
        >
          API tokens
        </button>
        <button
          type="button"
          onClick={onSignOut}
          className="w-full rounded px-2 py-1.5 text-left text-xs text-[#7a7d86] hover:bg-[#232529]"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
