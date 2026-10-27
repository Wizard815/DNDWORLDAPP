import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { FieldVisibility, NodeDetail, NodeSummary, PageRef, RelationDto } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { navigate } from "../lib/nav.ts";
import { Glyph } from "./Glyph.tsx";

/**
 * The Info panel's Connections section (design doc §3): every way this page
 * is connected to others, in text, with the server deciding what this viewer
 * may see. Relations are curated and editable here; link fields are shown as
 * relations but edited as fields; links, map pins and wanted pages come from
 * what's written and placed elsewhere.
 */

const ARROW: Record<"out" | "in" | "both", string> = { out: "→", in: "←", both: "↔" };
const VISIBILITY_OPTIONS: { value: FieldVisibility; label: string }[] = [
  { value: "members", label: "Players" },
  { value: "public", label: "Public" },
  { value: "dm", label: "DM only" },
];

function SectionTitle({ children }: { children: string }) {
  return <h3 className="mb-1 mt-4 text-[10px] font-medium uppercase tracking-wide text-fg-faint first:mt-0">{children}</h3>;
}

function PageButton({ page, suffix }: { page: PageRef; suffix?: string }) {
  return (
    <button
      type="button"
      onClick={() => navigate(`/n/${page.id}`)}
      className="flex min-w-0 items-center gap-1.5 truncate rounded text-left text-fg-soft hover:text-fg-strong hover:underline"
    >
      <Glyph icon={page.icon ?? "📄"} className="shrink-0" />
      <span className="truncate">{page.title}</span>
      {suffix !== undefined && <span className="shrink-0 text-[10px] text-fg-faint">{suffix}</span>}
    </button>
  );
}

function PageList({ pages }: { pages: (PageRef & { markerCount?: number })[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {pages.map((page) => (
        <li key={page.id}>
          <PageButton
            page={page}
            suffix={page.markerCount !== undefined && page.markerCount > 1 ? `${page.markerCount} pins` : undefined}
          />
        </li>
      ))}
    </ul>
  );
}

export function Connections({
  node,
  allNodes,
  isGameMaster,
  canCreate,
  onCreateNamed,
}: {
  node: NodeDetail;
  allNodes: NodeSummary[];
  isGameMaster: boolean;
  canCreate: boolean;
  onCreateNamed: (title: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["connections", node.id],
    queryFn: () => api.connections(node.id),
  });
  const [editing, setEditing] = useState<RelationDto | "new" | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["connections"] });
    void queryClient.invalidateQueries({ queryKey: ["relation-labels", node.worldId] });
  };
  const remove = useMutation({ mutationFn: (id: string) => api.deleteRelation(id), onSuccess: refresh });

  const c = data?.connections;
  if (isLoading || c === undefined) return <p className="text-xs text-fg-faint">Loading connections…</p>;

  const nothing =
    c.relations.length + c.fieldLinks.length + c.mentionedIn.length + c.linksTo.length + c.onMaps.length + c.wanted.length === 0;

  return (
    <section aria-label="Connections">
      <SectionTitle>Relations</SectionTitle>
      {c.relations.length + c.fieldLinks.length === 0 && editing === null && (
        <p className="text-xs text-fg-faint">None yet.</p>
      )}
      <ul className="space-y-1.5 text-sm">
        {c.relations.map((rel) =>
          editing !== "new" && editing?.id === rel.id ? (
            <li key={rel.id}>
              <RelationForm
                node={node}
                allNodes={allNodes}
                isGameMaster={isGameMaster}
                existing={rel}
                onDone={() => {
                  setEditing(null);
                  refresh();
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={rel.id} className="group">
              <div className="flex items-center gap-1.5">
                <span className="w-3 shrink-0 text-center text-fg-faint" aria-hidden="true">
                  {ARROW[rel.twoWay ? "both" : (rel.direction ?? "out")]}
                </span>
                <span className="shrink-0 text-xs text-fg-subtle">{rel.reading}</span>
                {rel.other !== undefined && <PageButton page={rel.other} />}
                {rel.visibility === "dm" && (
                  <span className="shrink-0 text-[10px] text-secret" title="DM only">
                    ●
                  </span>
                )}
                {rel.canEdit && (
                  <span className="ml-auto hidden shrink-0 gap-1 group-hover:flex group-focus-within:flex">
                    <button
                      type="button"
                      onClick={() => setEditing(rel)}
                      className="rounded px-1 text-xs text-fg-muted hover:bg-hover hover:text-fg"
                      aria-label={`Edit relation ${rel.reading} ${rel.other?.title ?? ""}`}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(rel.id)}
                      className="rounded px-1 text-xs text-fg-muted hover:bg-hover hover:text-danger"
                      aria-label={`Remove relation ${rel.reading} ${rel.other?.title ?? ""}`}
                    >
                      ×
                    </button>
                  </span>
                )}
              </div>
              {rel.note.length > 0 && <p className="ml-[1.125rem] text-[11px] text-fg-faint">{rel.note}</p>}
            </li>
          ),
        )}
        {c.fieldLinks.map((f) => (
          <li key={`${f.fieldId}-${f.direction}`} className="flex items-center gap-1.5">
            <span className="w-3 shrink-0 text-center text-fg-faint" aria-hidden="true">
              {ARROW[f.direction]}
            </span>
            <span className="shrink-0 text-xs text-fg-subtle">{f.label}</span>
            <PageButton page={f.other} />
            <span className="shrink-0 rounded bg-hover px-1 text-[9px] uppercase tracking-wide text-fg-faint" title="A link field — edit it under Fields">
              field
            </span>
          </li>
        ))}
      </ul>
      {node.canEdit &&
        (editing === "new" ? (
          <RelationForm
            node={node}
            allNodes={allNodes}
            isGameMaster={isGameMaster}
            onDone={() => {
              setEditing(null);
              refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="mt-1 rounded px-1 text-xs text-fg-muted hover:bg-hover hover:text-fg"
          >
            + Add relation
          </button>
        ))}

      {c.mentionedIn.length > 0 && (
        <>
          <SectionTitle>Mentioned in</SectionTitle>
          <PageList pages={c.mentionedIn} />
        </>
      )}
      {c.linksTo.length > 0 && (
        <>
          <SectionTitle>Links to</SectionTitle>
          <PageList pages={c.linksTo} />
        </>
      )}
      {c.onMaps.length > 0 && (
        <>
          <SectionTitle>On maps</SectionTitle>
          <PageList pages={c.onMaps} />
        </>
      )}
      {c.wanted.length > 0 && (
        <>
          <SectionTitle>Wanted</SectionTitle>
          <ul className="space-y-1 text-sm">
            {c.wanted.map((w) => (
              <li key={w.targetText} className="flex items-center gap-1.5">
                <span className="truncate text-danger-soft">{w.targetText}</span>
                {w.count > 1 && <span className="text-[10px] text-fg-faint">×{w.count}</span>}
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => onCreateNamed(w.targetText)}
                    className="ml-auto shrink-0 rounded px-1 text-xs text-fg-muted hover:bg-hover hover:text-fg"
                  >
                    Create
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {nothing && !node.canEdit && <p className="mt-2 text-xs text-fg-faint">Nothing connects here yet.</p>}
    </section>
  );
}

/**
 * Add or edit a relation inline. The label autocompletes from labels the
 * world already uses (and picking one prefills its usual inverse / two-way),
 * so "reports to" stays one label rather than five spellings of it.
 */
function RelationForm({
  node,
  allNodes,
  isGameMaster,
  existing,
  onDone,
  onCancel,
}: {
  node: NodeDetail;
  allNodes: NodeSummary[];
  isGameMaster: boolean;
  existing?: RelationDto;
  onDone: () => void;
  onCancel: () => void;
}) {
  const reversed = existing?.direction === "in" && !existing.twoWay;
  const [targetId, setTargetId] = useState<string | null>(existing?.other?.id ?? null);
  const [query, setQuery] = useState(existing?.other?.title ?? "");
  // Editing from the target's side shows the labels flipped, the way that
  // page reads them; they're flipped back on save.
  const [label, setLabel] = useState(reversed ? (existing?.inverseLabel ?? existing?.label ?? "") : (existing?.label ?? ""));
  const [inverse, setInverse] = useState(reversed ? (existing?.label ?? "") : (existing?.inverseLabel ?? ""));
  const [twoWay, setTwoWay] = useState(existing?.twoWay ?? false);
  const [note, setNote] = useState(existing?.note ?? "");
  const [visibility, setVisibility] = useState<FieldVisibility>(existing?.visibility ?? "members");
  const [error, setError] = useState<string | null>(null);

  const labels = useQuery({
    queryKey: ["relation-labels", node.worldId],
    queryFn: () => api.relationLabels(node.worldId),
    staleTime: 30_000,
  }).data?.labels ?? [];

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (targetId !== null || needle.length === 0) return [];
    return allNodes.filter((n) => n.id !== node.id && n.title.toLowerCase().includes(needle)).slice(0, 8);
  }, [allNodes, node.id, query, targetId]);

  const save = useMutation({
    mutationFn: async () => {
      const forward = reversed ? (inverse.trim() || label.trim()) : label.trim();
      const backward = reversed ? label.trim() : inverse.trim();
      if (existing !== undefined) {
        return api.updateRelation(existing.id, {
          label: forward,
          inverseLabel: twoWay || backward.length === 0 ? null : backward,
          twoWay,
          note,
          visibility,
        });
      }
      return api.createRelation(node.id, {
        targetNodeId: targetId!,
        label: forward,
        inverseLabel: twoWay || backward.length === 0 ? null : backward,
        twoWay,
        note,
        visibility,
      });
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof Error ? e.message : "Couldn't save that relation."),
  });

  const pickLabel = (value: string) => {
    setLabel(value);
    const known = labels.find((l) => l.label.toLowerCase() === value.trim().toLowerCase());
    if (known !== undefined && existing === undefined) {
      setTwoWay(known.twoWay);
      if (inverse.length === 0 && known.inverseLabel !== null) setInverse(known.inverseLabel);
    }
  };

  const canSave = label.trim().length > 0 && (existing !== undefined || targetId !== null);
  const input =
    "w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-faint focus:border-line-strong";

  return (
    <form
      className="mt-1 space-y-1.5 rounded-md border border-line bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) save.mutate();
      }}
    >
      {existing === undefined ? (
        <div className="relative">
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setTargetId(null);
            }}
            placeholder="Which page?"
            aria-label="Related page"
            className={input}
          />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-0.5 max-h-48 w-full overflow-y-auto rounded-md border border-line bg-raised py-1 shadow-pop">
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetId(m.id);
                      setQuery(m.title);
                    }}
                    className="menu-item"
                  >
                    <Glyph icon={m.icon ?? "📄"} />
                    <span className="truncate">{m.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-xs text-fg-subtle">
          With <span className="text-fg">{existing.other?.title}</span>
        </p>
      )}
      <input
        value={label}
        onChange={(e) => pickLabel(e.target.value)}
        list={`relation-labels-${node.id}`}
        placeholder={`This page… e.g. "reports to"`}
        aria-label="Relation label"
        className={input}
      />
      <datalist id={`relation-labels-${node.id}`}>
        {labels.map((l) => (
          <option key={l.label} value={l.label} />
        ))}
      </datalist>
      {!twoWay && (
        <input
          value={inverse}
          onChange={(e) => setInverse(e.target.value)}
          placeholder={`…and the other reads it as (optional), e.g. "commands"`}
          aria-label="Inverse label"
          className={input}
        />
      )}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional), e.g. since the coup"
        aria-label="Note"
        className={input}
      />
      <div className="flex items-center gap-2 text-xs">
        <label className="flex cursor-pointer items-center gap-1 text-fg-soft">
          <input type="checkbox" checked={twoWay} onChange={(e) => setTwoWay(e.target.checked)} className="accent-accent" />
          Two-way
        </label>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as FieldVisibility)}
          aria-label="Who can see this relation"
          className="ml-auto rounded border border-line bg-canvas px-1 py-0.5 text-xs text-fg"
        >
          {VISIBILITY_OPTIONS.filter((o) => o.value !== "dm" || isGameMaster).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {error !== null && <p className="text-[11px] text-danger">{error}</p>}
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onCancel} className="rounded px-2 py-0.5 text-xs text-fg-muted hover:text-fg">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSave || save.isPending}
          className="rounded bg-accent px-2 py-0.5 text-xs text-on-accent hover:bg-accent-hover disabled:opacity-40"
        >
          {existing !== undefined ? "Save" : "Add"}
        </button>
      </div>
    </form>
  );
}
