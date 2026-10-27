import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { TAG_COLORS, type TagColor, type TagDto } from "@dndworldapp/schema";
import { ApiError, api } from "../api.ts";
import { nodeGlyph } from "../lib/kinds.ts";
import { navigate } from "../lib/nav.ts";
import { useWorldTags } from "../lib/useWorldTags.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Glyph } from "./Glyph.tsx";
import { VISIBILITY_CLASS } from "./NodeView.tsx";

/**
 * The Tags screen (`/tags`, `/tags/<id>`): every tag with its count on the
 * left, nested by `/`; the selected tag's pages on the right. Ctrl/⌘-click
 * more tags to narrow to pages that carry all of them. Owner/DM can rename,
 * recolor, describe, merge and delete from here — the only place that can.
 */
export function TagsView({
  worldId,
  selectedTagId,
  isGameMaster,
}: {
  worldId: string;
  selectedTagId: string | null;
  isGameMaster: boolean;
}) {
  const queryClient = useQueryClient();
  const tagsQuery = useWorldTags(worldId);
  const tags = tagsQuery.data?.tags ?? [];
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [sort, setSort] = useState<"name" | "count">("name");
  const [confirmDelete, setConfirmDelete] = useState<TagDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const selected = selectedTagId !== null ? (byId.get(selectedTagId) ?? null) : null;
  const activeIds = selected !== null ? [selected.id, ...extraIds.filter((id) => id !== selected.id && byId.has(id))] : [];

  /** Pages under a tag including nested tags — the count the list shows next to the direct one. */
  const inclusiveCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tags) {
      let cur: TagDto | undefined = t;
      while (cur !== undefined) {
        counts.set(cur.id, (counts.get(cur.id) ?? 0) + t.pageCount);
        cur = cur.parentTagId !== null ? byId.get(cur.parentTagId) : undefined;
      }
    }
    return counts;
  }, [tags, byId]);

  const ordered = useMemo(() => {
    const list = tags.slice();
    if (sort === "count") list.sort((a, b) => (inclusiveCount.get(b.id) ?? 0) - (inclusiveCount.get(a.id) ?? 0) || a.name.localeCompare(b.name));
    else list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [tags, sort, inclusiveCount]);

  const pageQueries = useQueries({
    queries: activeIds.map((id) => ({
      queryKey: ["tag-pages", id],
      queryFn: () => api.tagPages(id, true),
    })),
  });
  const pages = useMemo(() => {
    if (pageQueries.length === 0 || pageQueries.some((q) => q.data === undefined)) return null;
    const [first, ...rest] = pageQueries.map((q) => q.data!.nodes);
    return first!.filter((n) => rest.every((set) => set.some((m) => m.id === n.id)));
  }, [pageQueries]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tags", worldId] });
    void queryClient.invalidateQueries({ queryKey: ["tag-pages"] });
    void queryClient.invalidateQueries({ queryKey: ["tree"] });
  };
  const onError = (err: unknown) => setError(err instanceof ApiError ? err.message : "Something went wrong.");
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof api.updateTag>[1]) => api.updateTag(id, input),
    onSuccess: refresh,
    onError,
  });
  const merge = useMutation({
    mutationFn: ({ id, intoId }: { id: string; intoId: string }) => api.mergeTag(id, intoId),
    onSuccess: (result) => {
      refresh();
      navigate(`/tags/${result.tag.id}`);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTag(id),
    onSuccess: () => {
      refresh();
      navigate("/tags");
    },
    onError,
  });

  function pick(tag: TagDto, additive: boolean): void {
    setError(null);
    if (additive && selected !== null && tag.id !== selected.id) {
      setExtraIds((prev) => (prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]));
      return;
    }
    setExtraIds([]);
    navigate(`/tags/${tag.id}`);
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r border-divider bg-canvas">
        <div className="flex items-center gap-2 px-3 py-3">
          <h1 className="font-display text-base font-semibold text-fg-strong">Tags</h1>
          <span className="text-xs text-fg-muted">{tags.length}</span>
          <button
            type="button"
            onClick={() => setSort(sort === "name" ? "count" : "name")}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted hover:bg-hover hover:text-fg"
            title="Sort"
          >
            {sort === "name" ? "A–Z" : "by count"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {tags.length === 0 && (
            <p className="px-2 py-4 text-xs text-fg-muted">No tags yet. Write #tag in any page, or add one from a page's Tags row.</p>
          )}
          {ordered.map((tag) => {
            const depth = sort === "name" ? tag.name.split("/").length - 1 : 0;
            const label = sort === "name" ? tag.name.split("/").pop() : tag.name;
            const isActive = activeIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={(e) => pick(tag, e.ctrlKey || e.metaKey)}
                title={`#${tag.name}${tag.description.length > 0 ? ` — ${tag.description}` : ""}\nCtrl-click to narrow by more than one tag`}
                className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-[5px] text-left text-[13px] ${
                  isActive ? "bg-selected font-medium text-fg-strong" : "text-fg-soft hover:bg-hover hover:text-fg"
                }`}
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
              >
                <span className="tag-dot shrink-0" data-color={tag.color ?? undefined} />
                <span className="min-w-0 flex-1 truncate">#{label}</span>
                <span className="shrink-0 text-[11px] text-fg-faint">
                  {inclusiveCount.get(tag.id) ?? 0}
                  {(inclusiveCount.get(tag.id) ?? 0) !== tag.pageCount && ` (${tag.pageCount})`}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="min-h-0 flex-1 overflow-y-auto">
        {selected === null ? (
          <div className="mx-auto max-w-2xl px-8 py-10 text-sm text-fg-muted">
            <p className="mb-2 text-fg">Pick a tag on the left to see its pages.</p>
            <p>
              Tags are labels, not pages. Nest them with a slash — <code>#npc/villain</code> sits under <code>#npc</code>, and
              picking <code>#npc</code> shows both. Ctrl-click a second tag to show only pages that carry both.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-8 py-6">
            <TagHeader
              tag={selected}
              extra={extraIds.map((id) => byId.get(id)).filter((t): t is TagDto => t !== undefined)}
              allTags={tags}
              isGameMaster={isGameMaster}
              onRename={(name) => update.mutate({ id: selected.id, name })}
              onColor={(color) => update.mutate({ id: selected.id, color })}
              onDescribe={(description) => update.mutate({ id: selected.id, description })}
              onMerge={(intoId) => merge.mutate({ id: selected.id, intoId })}
              onDelete={() => setConfirmDelete(selected)}
              onClearExtra={() => setExtraIds([])}
            />
            {error !== null && (
              <p role="alert" className="mb-3 rounded-md border border-danger-line px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            {pages === null ? (
              <p className="text-sm text-fg-muted">Loading…</p>
            ) : pages.length === 0 ? (
              <p className="text-sm text-fg-muted">No pages carry {activeIds.length > 1 ? "all of these tags" : "this tag"} (that you can see).</p>
            ) : (
              <ul className="divide-y divide-divider">
                {pages.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/n/${n.id}`)}
                      className="flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-hover"
                    >
                      <Glyph icon={nodeGlyph(n)} className="w-5 shrink-0 text-center text-base" />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{n.title}</span>
                      <span className="flex shrink-0 gap-1">
                        {n.tags.slice(0, 4).map((t) => (
                          <span key={t.id} className="tag-chip text-[10px]" data-color={t.color ?? undefined}>
                            #{t.name}
                          </span>
                        ))}
                      </span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${VISIBILITY_CLASS[n.effectiveVisibility]}`}>
                        {n.effectiveVisibility === "members" ? "players" : n.effectiveVisibility === "dm" ? "DM" : n.effectiveVisibility}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {confirmDelete !== null && (
        <ConfirmDialog
          title={`Delete #${confirmDelete.name}?`}
          body="Pages keep everything else — they just lose this label. Tags nested under it go too."
          confirmLabel="Delete tag"
          danger
          onConfirm={() => {
            remove.mutate(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function TagHeader({
  tag,
  extra,
  allTags,
  isGameMaster,
  onRename,
  onColor,
  onDescribe,
  onMerge,
  onDelete,
  onClearExtra,
}: {
  tag: TagDto;
  extra: TagDto[];
  allTags: TagDto[];
  isGameMaster: boolean;
  onRename: (name: string) => void;
  onColor: (color: TagColor | null) => void;
  onDescribe: (description: string) => void;
  onMerge: (intoId: string) => void;
  onDelete: () => void;
  onClearExtra: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [description, setDescription] = useState(tag.description);
  const [merging, setMerging] = useState(false);
  const [key, setKey] = useState(tag.id);
  if (key !== tag.id) {
    setKey(tag.id);
    setName(tag.name);
    setDescription(tag.description);
    setMerging(false);
  }

  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tag-dot h-3 w-3" data-color={tag.color ?? undefined} />
        {isGameMaster ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const next = name.trim().toLowerCase();
              if (next.length > 0 && next !== tag.name) onRename(next);
              else setName(tag.name);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setName(tag.name);
            }}
            aria-label="Tag name"
            className="min-w-0 bg-transparent font-display text-2xl font-semibold text-fg-strong outline-none focus:border-b focus:border-line-strong"
          />
        ) : (
          <h1 className="font-display text-2xl font-semibold text-fg-strong">#{tag.name}</h1>
        )}
        {extra.map((t) => (
          <span key={t.id} className="tag-chip" data-color={t.color ?? undefined}>
            + #{t.name}
          </span>
        ))}
        {extra.length > 0 && (
          <button type="button" onClick={onClearExtra} className="text-xs text-fg-muted hover:text-fg">
            clear
          </button>
        )}
      </div>

      {isGameMaster && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="flex items-center gap-1" role="radiogroup" aria-label="Tag color">
            <button
              type="button"
              role="radio"
              aria-checked={tag.color === null}
              onClick={() => onColor(null)}
              title="No color"
              className={`h-5 w-5 rounded-full border ${tag.color === null ? "border-fg" : "border-line"} bg-canvas`}
            />
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={tag.color === c}
                onClick={() => onColor(c)}
                title={c}
                className={`tag-swatch h-5 w-5 rounded-full border ${tag.color === c ? "border-fg ring-2 ring-line-strong" : "border-transparent"}`}
                data-color={c}
              />
            ))}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {merging ? (
              <select
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value.length > 0) onMerge(e.target.value);
                  setMerging(false);
                }}
                onBlur={() => setMerging(false)}
                className="rounded-md border border-line bg-canvas px-2 py-1 text-xs"
              >
                <option value="" disabled>
                  Merge into…
                </option>
                {allTags
                  .filter((t) => t.id !== tag.id && !t.name.startsWith(`${tag.name}/`))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      #{t.name}
                    </option>
                  ))}
              </select>
            ) : (
              <button type="button" onClick={() => setMerging(true)} className="rounded border border-line px-2 py-1 text-fg-soft hover:bg-press">
                Merge into…
              </button>
            )}
            <button
              type="button"
              onClick={onDelete}
              className="rounded border border-line px-2 py-1 text-danger-soft hover:border-danger-line hover:text-danger"
            >
              Delete
            </button>
          </span>
        </div>
      )}

      {isGameMaster ? (
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== tag.description) onDescribe(description);
          }}
          placeholder="What this tag is for (optional)"
          rows={2}
          className="mt-3 w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-fg-soft outline-none hover:border-line focus:border-line-strong focus:bg-surface"
        />
      ) : (
        tag.description.length > 0 && <p className="mt-2 text-sm text-fg-soft">{tag.description}</p>
      )}
    </header>
  );
}
