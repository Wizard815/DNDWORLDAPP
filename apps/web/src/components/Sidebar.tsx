import { useEffect, useMemo, useState } from "react";
import type { MoveNodeInput, NodeSummary } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { nodeGlyph } from "../lib/kinds.ts";
import { navigate } from "../lib/nav.ts";
import { THEMES, type ThemeId } from "../lib/theme.ts";
import { useResizablePanel } from "../lib/useResizablePanel.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Glyph } from "./Glyph.tsx";

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
  /** Owner/DM: the Archived & Trash panel. */
  onOpenRemoved: () => void;
  onSignOut: () => void;
  isGameMaster: boolean;
  /** False for a read-only guest: no new/rename/archive/move, no member or token panels. */
  canCreate: boolean;
  viewAsPlayer: boolean;
  onToggleViewAsPlayer: () => void;
  theme: ThemeId;
  onChangeTheme: (theme: ThemeId) => void;
  /** Below the md breakpoint the sidebar is an off-canvas drawer; this says whether it's open. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function useExpanded(worldName: string) {
  const storageKey = `dwa:expanded:${worldName}`;
  const [stored] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set<string>(stored !== null ? (JSON.parse(stored) as string[]) : []);
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

  /** True the very first time this world is opened in this browser — nothing has been expanded or collapsed yet. */
  const isFirstVisit = stored === null;

  return { expanded, toggle, setExpanded, isFirstVisit };
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
  onOpenRemoved,
  onSignOut,
  isGameMaster,
  canCreate,
  viewAsPlayer,
  onToggleViewAsPlayer,
  theme,
  onChangeTheme,
  mobileOpen,
  onCloseMobile,
}: Props) {
  const [dmMenuOpen, setDmMenuOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const panel = useResizablePanel({ storageKey: "dwa:sidebar", defaultWidth: 290, minWidth: 200, maxWidth: 480 });
  const { expanded, toggle, setExpanded, isFirstVisit } = useExpanded(worldName);
  const [tagsOpen, setTagsOpen] = useState(false);
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

  // A world opened for the first time in this browser shows its root page's
  // children instead of a single collapsed row. Runs once, when the tree lands.
  const [seeded, setSeeded] = useState(!isFirstVisit);
  useEffect(() => {
    if (seeded || nodes.length === 0) return;
    setSeeded(true);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const node of nodes) if (node.parentId === null && node.kind !== "tag") next.add(node.id);
      return next;
    });
  }, [seeded, nodes, setExpanded]);

  /** When filtering, keep any node that matches or has a matching descendant. */
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return null;
    // "#tag" filters by tag instead of title (prefix match, so "#sess" finds #session).
    const tagNeedle = needle.startsWith("#") ? needle.slice(1) : null;
    const keep = new Set<string>();
    for (const node of nodes) {
      const matches =
        tagNeedle !== null
          ? tagNeedle.length === 0 || node.tagNames.some((t) => t.toLowerCase().startsWith(tagNeedle))
          : node.title.toLowerCase().includes(needle);
      if (!matches) continue;
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

  /** Both removals take the subtree with them, so confirm first (childCount is enough — no detail fetch). */
  const [pendingRemoval, setPendingRemoval] = useState<{ node: NodeSummary; action: "archive" | "trash" } | null>(null);
  function requestRemoval(node: NodeSummary, action: "archive" | "trash"): void {
    closeMenu();
    setPendingRemoval({ node, action });
  }
  function confirmRemoval(): void {
    if (pendingRemoval === null) return;
    const { node, action } = pendingRemoval;
    setPendingRemoval(null);
    void (action === "archive" ? api.archiveNode(node.id) : api.trashNode(node.id)).then(
      onChanged,
      () => {
        /* server rejected it (not this viewer's to remove) — nothing to undo client-side */
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
          draggable={canCreate && !isRenaming}
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
            "group relative flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-[5px] text-[13px]",
            isActive ? "bg-selected font-medium text-fg-strong" : "text-fg-soft hover:bg-hover hover:text-fg",
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
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] text-fg-muted hover:bg-hover-strong hover:text-fg ${children.length === 0 ? "invisible" : ""}`}
            aria-label={isOpen ? `Collapse ${node.title}` : `Expand ${node.title}`}
          >
            {isOpen ? "▾" : "▸"}
          </button>
          <Glyph icon={nodeGlyph(node)} className="shrink-0 text-[13px] leading-none" />
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
              className="min-w-0 flex-1 rounded border border-line-strong bg-canvas px-1 text-fg-strong outline-none"
            />
          ) : (
            <span className="truncate">{node.title}</span>
          )}
          {isPinned && (
            <span className="shrink-0 text-[10px] text-secret" title="Pinned">
              ★
            </span>
          )}
          {node.effectiveVisibility === "dm" && (
            <span className="ml-auto shrink-0 text-[10px] text-secret" title="DM only">
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
            className="ml-auto hidden shrink-0 rounded px-1 leading-none text-fg-muted hover:bg-hover-strong hover:text-fg group-hover:block"
            title="Page actions"
          >
            ⋯
          </button>
          {menuForId === node.id && menuPos !== null && (
            <>
              <div
                className="fixed inset-0 z-[2030]"
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
                className="fixed z-[2040] w-48 overflow-hidden rounded-lg border border-line bg-raised py-1 shadow-pop"
              >
                {canCreate && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        closeMenu();
                        onOpenCreateChooser(node.id);
                      }}
                      className="menu-item"
                    >
                      Add a page under…
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(node)}
                      className="menu-item"
                    >
                      Rename
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    closeMenu();
                    onTogglePin(node.id);
                  }}
                  className="menu-item"
                >
                  {isPinned ? "Unpin" : "Pin"}
                </button>
                {canCreate && (
                  <>
                    <button
                      type="button"
                      onClick={() => requestRemoval(node, "archive")}
                      title="Keep it, out of the way, until you restore it"
                      className="menu-item"
                    >
                      Archive{node.childCount > 0 && ` (+${node.childCount})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => requestRemoval(node, "trash")}
                      title="Move to the trash — deleted for good after 30 days"
                      className="menu-item menu-item-danger"
                    >
                      Delete{node.childCount > 0 && ` (+${node.childCount})`}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        {isOpen && children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  }

  // Tags auto-create as top-level pages (see the server's tag indexer); listing
  // each one beside the world's real root pages buried the tree under a pile
  // of #labels, so top-level tags get their own collapsible group instead.
  // A page can be visible while the page above it isn't (a Players page inside a
  // DM-only folder) — it comes down with a parentId the viewer can't see, so
  // show it at the top level rather than nowhere.
  const allRoots = [...(byParent.get(null) ?? []), ...nodes.filter((n) => n.parentId !== null && !byId.has(n.parentId))];
  const roots = allRoots.filter((n) => n.kind !== "tag");
  const rootTags = allRoots.filter((n) => n.kind === "tag").sort((a, b) => a.title.localeCompare(b.title));
  const showTags = tagsOpen || (visible !== null && rootTags.some((t) => visible.has(t.id)));

  if (panel.collapsed && !mobileOpen) {
    return (
      <aside className="hidden h-full w-9 shrink-0 flex-col items-center border-r border-divider bg-panel py-3 md:flex">
        <button
          type="button"
          onClick={panel.toggleCollapsed}
          className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
          title="Show sidebar"
          aria-label="Show sidebar"
        >
          »
        </button>
      </aside>
    );
  }

  const footerButton =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg-subtle hover:bg-hover hover:text-fg";

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-[2044] bg-black/50 md:hidden" onClick={onCloseMobile} aria-hidden="true" />
      )}
      <aside
        style={{ width: panel.width }}
        className={[
          "flex h-full shrink-0 flex-col border-r border-divider bg-panel",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[2045] max-md:w-[85vw]! max-md:max-w-xs max-md:shadow-pop max-md:transition-transform",
          mobileOpen ? "" : "max-md:-translate-x-full",
          "md:relative",
        ].join(" ")}
      >
        <div className="flex items-center gap-2 px-3 pb-2 pt-3">
          <span className="truncate font-display text-[15px] font-semibold tracking-tight text-fg-strong">
            {worldName}
          </span>
          <button
            type="button"
            onClick={panel.toggleCollapsed}
            className="ml-auto hidden rounded p-1 text-fg-muted hover:bg-hover hover:text-fg md:block"
            title="Hide sidebar"
            aria-label="Hide sidebar"
          >
            «
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto rounded p-1 text-fg-muted hover:bg-hover hover:text-fg md:hidden"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenSwitcher}
          className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 text-left text-xs text-fg-muted hover:border-line-strong hover:text-fg-soft"
          title="Search every page (Ctrl+K)"
        >
          <span aria-hidden="true">⌕</span>
          <span>Search pages…</span>
          <kbd className="ml-auto rounded border border-line px-1 font-sans text-[10px] text-fg-faint">Ctrl K</kbd>
        </button>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter the tree, or #tag"
          aria-label="Filter the tree by name"
          className="mx-3 mb-2 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-fg placeholder:text-fg-faint outline-none hover:border-line focus:border-line-strong focus:bg-surface"
        />

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {roots.map((node) => renderRow(node, 0))}
          {roots.length === 0 && (
            <p className="px-2 py-4 text-xs text-fg-muted">Nothing here yet.</p>
          )}

          {rootTags.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setTagsOpen(!tagsOpen)}
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted hover:text-fg"
                aria-expanded={showTags}
              >
                <span className="w-4 text-[9px]">{showTags ? "▾" : "▸"}</span>
                Tags
                <span className="ml-auto font-normal normal-case text-fg-faint">{rootTags.length}</span>
              </button>
              {showTags && rootTags.map((node) => renderRow(node, 0))}
            </div>
          )}
        </div>

        <div className="space-y-0.5 border-t border-divider p-2">
          {canCreate && (
            <button
              type="button"
              onClick={() => onOpenCreateChooser(null)}
              className="mb-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover"
            >
              + New page
            </button>
          )}
          <div className="relative">
            {viewAsPlayer && (
              <button
                type="button"
                onClick={onToggleViewAsPlayer}
                className="mb-1 w-full rounded-md bg-secret-bg-strong px-2 py-1 text-left text-[11px] text-secret-fg"
                title="Click to stop previewing"
              >
                👁 Viewing as a player — stop
              </button>
            )}
            <button type="button" onClick={() => setDmMenuOpen(!dmMenuOpen)} className={footerButton}>
              <span aria-hidden="true">☰</span>
              {isGameMaster ? "DM Menu" : "Menu"}
            </button>
            {dmMenuOpen && (
              <>
                <div className="fixed inset-0 z-[2010]" onClick={() => setDmMenuOpen(false)} />
                <div className="absolute bottom-full left-0 z-[2050] mb-1 w-full overflow-hidden rounded-lg border border-line bg-raised py-1 shadow-pop">
                  {canCreate && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setDmMenuOpen(false);
                          onOpenMembers();
                        }}
                        className="menu-item"
                      >
                        Members
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDmMenuOpen(false);
                          onOpenTokens();
                        }}
                        className="menu-item"
                      >
                        API tokens
                      </button>
                    </>
                  )}
                  {isGameMaster && (
                    <button
                      type="button"
                      onClick={() => {
                        setDmMenuOpen(false);
                        onOpenTemplates();
                      }}
                      className="menu-item"
                    >
                      Templates
                    </button>
                  )}
                  {isGameMaster && (
                    <button
                      type="button"
                      onClick={() => {
                        setDmMenuOpen(false);
                        onOpenRemoved();
                      }}
                      className="menu-item"
                    >
                      Archived &amp; Trash
                    </button>
                  )}
                  {isGameMaster && (
                    <button
                      type="button"
                      onClick={() => {
                        setDmMenuOpen(false);
                        onToggleViewAsPlayer();
                      }}
                      className="menu-item"
                    >
                      {viewAsPlayer ? "✓ Viewing as a player" : "View as a player"}
                    </button>
                  )}
                  <div className="menu-separator" />
                  <div className="px-3 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
                    Theme
                  </div>
                  <div className="flex gap-1 px-2 pb-1.5">
                    {THEMES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onChangeTheme(t.id)}
                        aria-pressed={theme === t.id}
                        className={`flex flex-1 flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] ${
                          theme === t.id
                            ? "border-accent text-fg-strong"
                            : "border-line text-fg-subtle hover:border-line-strong hover:text-fg"
                        }`}
                      >
                        <span
                          className="h-3 w-3 rounded-full border border-black/20"
                          style={{ background: t.swatch }}
                        />
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={onSignOut} className={footerButton}>
            <span aria-hidden="true">⎋</span>
            Sign out
          </button>
        </div>

        {pendingRemoval !== null && (
        <ConfirmDialog
          title={`${pendingRemoval.action === "archive" ? "Archive" : "Delete"} "${pendingRemoval.node.title}"?`}
          body={
            (pendingRemoval.node.childCount > 0 ? `The ${pendingRemoval.node.childCount} page(s) inside it go with it. ` : "") +
            (pendingRemoval.action === "archive"
              ? "It stays in Archived & Trash until you restore it."
              : "It goes to the trash and is deleted for good after 30 days unless you restore it.")
          }
          confirmLabel={pendingRemoval.action === "archive" ? "Archive" : "Delete"}
          danger={pendingRemoval.action === "trash"}
          onConfirm={confirmRemoval}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
      {/* Drag to resize; the sidebar is docked to the left, so dragging right grows it. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          onPointerDown={(e) => panel.startResize(e, "left")}
          onDoubleClick={panel.resetWidth}
          onKeyDown={(e) => panel.handleKeyDown(e, "left")}
          className="absolute right-0 top-0 hidden h-full w-1 cursor-col-resize hover:bg-line-strong focus:bg-line-strong focus:outline-none md:block"
        />
      </aside>
    </>
  );
}
