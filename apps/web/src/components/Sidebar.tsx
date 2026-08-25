import { useEffect, useMemo, useState } from "react";
import type { MoveNodeInput, NodeSummary } from "@dndworldapp/schema";
import { api } from "../api.ts";
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
  onOpenCreateChooser: (parentId: string | null) => void;
  onMove: (nodeId: string, input: MoveNodeInput) => void;
  onChanged: () => void;
  pinnedIds: Set<string>;
  onTogglePin: (nodeId: string) => void;
  onOpenSwitcher: () => void;
  onOpenTokens: () => void;
  onOpenMembers: () => void;
  onOpenTemplates: () => void;
  onSignOut: () => void;
  isGameMaster: boolean;
  viewAsPlayer: boolean;
  onToggleViewAsPlayer: () => void;
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
  onOpenCreateChooser,
  onMove,
  onChanged,
  pinnedIds,
  onTogglePin,
  onOpenSwitcher,
  onOpenTokens,
  onOpenMembers,
  onOpenTemplates,
  onSignOut,
  isGameMaster,
  viewAsPlayer,
  onToggleViewAsPlayer,
}: Props) {
  const [dmMenuOpen, setDmMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { expanded, toggle, setExpanded } = useExpanded(worldName);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; mode: DropMode } | null>(null);
  const [menuForId, setMenuForId] = useState<string | null>(null);
  /**
   * Screen coordinates for the row action menu, captured at open time.
   * The menu renders `fixed` at this point rather than `absolute` inside the
   * row: the tree lives in a `flex-1 overflow-y-auto` scroller (below), and
   * setting only `overflow-y` makes a browser compute `overflow-x: auto` too
   * (CSS overflow spec) — so an `absolute` menu wide enough to spill past the
   * narrow 290px sidebar column was being clipped by that scroller instead of
   * floating over the page, which showed up as a horizontal scrollbar
   * appearing at the sidebar's bottom edge rather than a visible dropdown.
   * `fixed` positioning escapes that ancestor's overflow clipping entirely.
   */
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  /** Clamped so a row near the sidebar's bottom/right doesn't open a menu off-screen. */
  function openMenuAt(id: string, x: number, y: number): void {
    const MENU_WIDTH = 192; // w-48
    const MENU_HEIGHT = 150; // ~4 rows
    setMenuForId(id);
    setMenuPos({
      x: Math.min(x, window.innerWidth - MENU_WIDTH - 8),
      y: Math.min(y, window.innerHeight - MENU_HEIGHT - 8),
    });
  }

  function closeMenu(): void {
    setMenuForId(null);
    setMenuPos(null);
  }

  function startRename(node: NodeSummary): void {
    closeMenu();
    setRenamingId(node.id);
    setRenameValue(node.title);
  }

  async function commitRename(node: NodeSummary): Promise<void> {
    const title = renameValue.trim();
    setRenamingId(null);
    if (title.length === 0 || title === node.title) return;
    try {
      await api.updateNode(node.id, { title });
      onChanged();
    } catch {
      // No toast system yet — a rename a viewer isn't allowed to make (rare: the
      // "Rename" item shows for everyone, same as every other mutation here, and
      // the server is the real gate) just silently reverts to the original title.
    }
  }

  /** Archiving takes the subtree with it, so confirm first using childCount alone (no need to fetch full detail). */
  function requestArchive(node: NodeSummary): void {
    closeMenu();
    const inside = node.childCount > 0 ? ` and the ${node.childCount} page(s) inside it` : "";
    if (!window.confirm(`Archive "${node.title}"${inside}?`)) return;
    void api.archiveNode(node.id).then(
      onChanged,
      () => {
        /* server rejected it (not this viewer's to archive) — nothing to undo client-side */
      },
    );
  }

  function renderRow(node: NodeSummary, depth: number) {
    if (visible !== null && !visible.has(node.id)) return null;
    const children = byParent.get(node.id) ?? [];
    const isOpen = expanded.has(node.id);
    const isActive = node.id === activeId;
    const drop = dropTarget?.id === node.id ? dropTarget.mode : null;
    const isRenaming = renamingId === node.id;
    const isPinned = pinnedIds.has(node.id);

    return (
      <div key={node.id}>
        <div
          draggable={!isRenaming}
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
          onClick={() => !isRenaming && navigate(`/n/${node.id}`)}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenuAt(node.id, e.clientX, e.clientY);
          }}
          className={[
            "group relative flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-sm",
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
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => void commitRename(node)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename(node);
                if (e.key === "Escape") setRenamingId(null);
              }}
              className="min-w-0 flex-1 rounded border border-[#4a4d55] bg-[#17181b] px-1 text-[#f0f1f4] outline-none"
            />
          ) : (
            <span className="truncate">{node.title}</span>
          )}
          {isPinned && (
            <span className="shrink-0 text-[10px] text-[#c9a227]" title="Pinned">
              ★
            </span>
          )}
          {node.visibility === "dm" && (
            <span className="ml-auto shrink-0 text-[10px] text-[#c9a227]" title="DM only">
              ●
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              openMenuAt(node.id, rect.left, rect.bottom + 4);
            }}
            className="ml-1 hidden shrink-0 px-1 text-[#7a7d86] hover:text-[#d7d8dc] group-hover:block"
            title="Page actions"
          >
            ⋯
          </button>
          {menuForId === node.id && menuPos !== null && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={(e) => {
                  e.stopPropagation();
                  closeMenu();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeMenu();
                }}
              />
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ top: menuPos.y, left: menuPos.x }}
                className="fixed z-40 w-48 overflow-hidden rounded-md border border-[#33363d] bg-[#22242a] shadow-lg"
              >
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    onOpenCreateChooser(node.id);
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                >
                  Add a page under…
                </button>
                <button
                  type="button"
                  onClick={() => startRename(node)}
                  className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    onTogglePin(node.id);
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                >
                  {isPinned ? "Unpin" : "Pin"}
                </button>
                <button
                  type="button"
                  onClick={() => requestArchive(node)}
                  className="block w-full px-3 py-2 text-left text-xs text-[#c98b8b] hover:bg-[#2b2e35]"
                >
                  Archive{node.childCount > 0 && ` (+${node.childCount})`}
                </button>
              </div>
            </>
          )}
        </div>
        {isOpen && children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  }

  const roots = byParent.get(null) ?? [];

  return (
    <aside className="flex h-full w-[290px] shrink-0 flex-col border-r border-[#26282d] bg-[#1a1c20]">
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
          onClick={() => onOpenCreateChooser(null)}
          className="w-full rounded px-2 py-1.5 text-left text-xs text-[#8d9099] hover:bg-[#232529] hover:text-[#d7d8dc]"
        >
          + New
        </button>
        <div className="relative">
          {viewAsPlayer && (
            <div className="mb-1 rounded bg-[#3a2f16] px-2 py-1 text-[10px] text-[#e8cf8a]">
              Viewing as a player
            </div>
          )}
          <button
            type="button"
            onClick={() => setDmMenuOpen(!dmMenuOpen)}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-[#7a7d86] hover:bg-[#232529] hover:text-[#d7d8dc]"
          >
            DM Menu
          </button>
          {dmMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDmMenuOpen(false)} />
              <div className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-md border border-[#33363d] bg-[#22242a] shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setDmMenuOpen(false);
                    onOpenMembers();
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                >
                  Members
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDmMenuOpen(false);
                    onOpenTokens();
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                >
                  API tokens
                </button>
                {isGameMaster && (
                  <button
                    type="button"
                    onClick={() => {
                      setDmMenuOpen(false);
                      onOpenTemplates();
                    }}
                    className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                  >
                    Templates
                  </button>
                )}
                {isGameMaster && (
                  <button
                    type="button"
                    onClick={() => {
                      setDmMenuOpen(false);
                      onToggleViewAsPlayer();
                    }}
                    className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                  >
                    {viewAsPlayer ? "✓ Viewing as a player" : "View as a player"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
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
