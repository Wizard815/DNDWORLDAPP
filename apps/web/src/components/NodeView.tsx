import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import type { FieldDto, FieldType, NodeDetail, NodeSummary, Visibility } from "@dndworldapp/schema";
import { ApiError, api } from "../api.ts";
import { Editor } from "../editor/Editor.tsx";
import { navigate } from "../lib/nav.ts";
import { useEscapeKey } from "../lib/useEscapeKey.ts";
import { nodeGlyph } from "../lib/kinds.ts";
import { useResizablePanel } from "../lib/useResizablePanel.ts";
import { Access } from "./Access.tsx";
import { IconPicker } from "./IconPicker.tsx";
import { Posts } from "./Posts.tsx";

// Leaflet and the map editor are most of the bundle; only map pages need them.
const MapView = lazy(() => import("./MapView.tsx").then((m) => ({ default: m.MapView })));

const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: "Public",
  members: "Players",
  dm: "DM only",
  private: "Just me",
};

export const VISIBILITY_CLASS: Record<Visibility, string> = {
  public: "text-success border-success-line",
  members: "text-fg-subtle border-line",
  dm: "text-secret border-secret-line",
  private: "text-violet border-violet-line",
};

interface Props {
  node: NodeDetail;
  allNodes: NodeSummary[];
  isGameMaster: boolean;
  onChanged: () => void;
  onOpenCreateChooser: (parentId: string) => void;
  onCreateNamed: (title: string) => void;
  onArchive: (node: NodeDetail) => void;
  pinnedIds: Set<string>;
  onTogglePin: (nodeId: string) => void;
  /** Opens the tags/backlinks/fields panel, which is a drawer below the lg breakpoint. */
  onOpenInfo: () => void;
}

export function NodeView({
  node,
  allNodes,
  isGameMaster,
  onChanged,
  onOpenCreateChooser,
  onCreateNamed,
  onArchive,
  pinnedIds,
  onTogglePin,
  onOpenInfo,
}: Props) {
  const [title, setTitle] = useState(node.title);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  // NOTE: there is deliberately no effect syncing local state back from `node`.
  // App renders this component with key={node.id}, so navigating remounts it with
  // fresh state. An effect keyed on node.title would fire on every autosave —
  // throwing the writer out of the title field a second after they pause.

  async function patch(input: Parameters<typeof api.updateNode>[1]): Promise<void> {
    setSaveState("saving");
    await api.updateNode(node.id, input);
    setSaveState("saved");
    onChanged();
    window.setTimeout(() => setSaveState("idle"), 1200);
  }

  function saveTitleIfChanged(): void {
    if (title !== node.title) void patch({ title });
  }

  function saveBody(bodyMd: string): void {
    if (bodyMd !== node.bodyMd) void patch({ bodyMd });
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center border-b border-divider px-4 md:px-8">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 overflow-hidden text-xs text-fg-muted">
          {node.breadcrumb.map((crumb) => (
            <span key={crumb.id} className="flex min-w-0 shrink items-center gap-1">
              <button
                type="button"
                onClick={() => navigate(`/n/${crumb.id}`)}
                className="truncate rounded px-1 py-0.5 hover:bg-hover hover:text-fg"
              >
                {crumb.icon ?? "📄"} {crumb.title}
              </button>
              <span className="text-line-strong">/</span>
            </span>
          ))}
          <span className="shrink-0 truncate px-1 text-fg-soft">{node.title}</span>
        </nav>
        <span className="ml-auto shrink-0 pl-3 text-[10px] text-fg-faint" aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
        </span>
        <button
          type="button"
          onClick={onOpenInfo}
          className="ml-2 shrink-0 rounded-md px-2 py-1 text-xs text-fg-subtle hover:bg-hover hover:text-fg lg:hidden"
          aria-label="Links, tags and fields"
        >
          ⓘ Info
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/*
         * Maps skip the max-w-3xl reading-width cap that documents use — a map
         * should use however much of the pane is actually available, the same
         * way every map editor referenced during the redesign pass (Kanka,
         * World Anvil, LegendKeeper) does. Capping it artificially narrower
         * than the pane, while MapView.tsx sizes its own aspect ratio from the
         * real image, was the other half of the "black bar on one side" bug —
         * the container's shape didn't match the image's, so Leaflet centered
         * it and left the mismatch as empty space.
         */}
        <div className={node.kind === "map" ? "w-full px-4 py-6 md:px-8" : "mx-auto w-full max-w-3xl px-5 py-8 md:px-8 md:py-10"}>
          <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-3">
            <IconPicker
              value={node.icon}
              disabled={!node.canEdit}
              onChange={(icon) => void patch({ icon })}
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitleIfChanged}
              disabled={!node.canEdit}
              aria-label="Page title"
              className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-0 bg-transparent font-display text-2xl font-semibold tracking-tight text-fg-strong outline-none placeholder:text-fg-faint disabled:opacity-90 md:text-3xl"
            />
            <select
              value={node.visibility}
              onChange={(e) => void patch({ visibility: e.target.value as Visibility })}
              disabled={!node.canEdit}
              className={`ml-auto shrink-0 cursor-pointer rounded-full border bg-surface px-2.5 py-1 text-xs disabled:cursor-default ${VISIBILITY_CLASS[node.visibility]}`}
              title="Who can see this page"
              aria-label="Visibility"
            >
              {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </option>
              ))}
            </select>

            {node.canEdit && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="rounded-md px-2 py-1 text-sm leading-none text-fg-subtle hover:bg-hover hover:text-fg"
                  aria-label="Page actions"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <>
                    {/* z-[20xx], not z-10/20: must clear MapView's in-map overlays (z-[1000]) when this page is a map — app chrome always wins over map content. */}
                    <div className="fixed inset-0 z-[2010]" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 z-[2020] mt-1 w-52 overflow-hidden rounded-lg border border-line bg-raised py-1 shadow-pop">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenCreateChooser(node.id);
                        }}
                        className="menu-item"
                      >
                        Add a page under…
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onTogglePin(node.id);
                        }}
                        className="menu-item"
                      >
                        {pinnedIds.has(node.id) ? "Unpin" : "Pin"}
                      </button>
                      {isGameMaster && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            setAccessOpen(true);
                          }}
                          className="menu-item"
                        >
                          Access…
                        </button>
                      )}
                      {isGameMaster && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            setTemplatePickerOpen(true);
                          }}
                          className="menu-item"
                        >
                          Template…
                        </button>
                      )}
                      {isGameMaster && node.templateId !== null && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            void api.applyTemplate(node.id).then(onChanged);
                          }}
                          className="menu-item"
                        >
                          Re-apply template
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setSourceOpen(true);
                        }}
                        className="menu-item"
                      >
                        View source…
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onArchive(node);
                        }}
                        className="menu-item menu-item-danger"
                      >
                        Archive page
                        {node.children.length > 0 && ` and ${node.children.length} inside`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {accessOpen && (
            <Access
              nodeId={node.id}
              worldId={node.worldId}
              nodeTitle={node.title}
              onClose={() => setAccessOpen(false)}
            />
          )}

          {templatePickerOpen && (
            <TemplatePicker
              node={node}
              onChanged={onChanged}
              onClose={() => setTemplatePickerOpen(false)}
            />
          )}

          {sourceOpen && (
            <div
              className="modal-backdrop pt-[8vh]"
              onClick={() => setSourceOpen(false)}
            >
              <div
                className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center">
                  <h2 className="text-base font-semibold text-fg-strong">Source — {node.title}</h2>
                  <button
                    type="button"
                    onClick={() => setSourceOpen(false)}
                    className="ml-auto text-sm text-fg-muted hover:text-fg"
                  >
                    Close
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded-md border border-selected bg-canvas p-4 font-mono text-xs text-fg-soft">
                  {node.bodyMd.length > 0 ? node.bodyMd : "(empty)"}
                </pre>
              </div>
            </div>
          )}

          {node.kind === "map" ? (
            <div className="overflow-hidden rounded-md border border-divider">
              <Suspense fallback={<div className="p-8 text-center text-sm text-fg-muted">Loading map…</div>}>
                <MapView node={node} allNodes={allNodes} isGameMaster={isGameMaster} />
              </Suspense>
            </div>
          ) : (
            <>
              <Editor
                key={node.id}
                nodeId={node.id}
                worldId={node.worldId}
                bodyMd={node.bodyMd}
                allNodes={allNodes}
                editable={node.canEdit}
                onCreateNamed={onCreateNamed}
                onChange={saveBody}
              />

              <Posts nodeId={node.id} bodyMd={node.bodyMd} canEdit={node.canEdit} allNodes={allNodes} />
            </>
          )}

          {node.children.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
                Child pages
              </h2>
              <ul className="grid gap-1 sm:grid-cols-2">
                {node.children.map((child) => (
                  <li key={child.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/n/${child.id}`)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-fg-soft hover:bg-hover"
                    >
                      <span>{nodeGlyph(child)}</span>
                      <span className="truncate">{child.title}</span>
                      {child.childCount > 0 && (
                        <span className="ml-auto text-[10px] text-fg-faint">
                          {child.childCount}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button
            type="button"
            onClick={() => onOpenCreateChooser(node.id)}
            className="mt-4 rounded px-2 py-1.5 text-xs text-fg-muted hover:bg-hover hover:text-fg"
          >
            + Add a page under {node.title}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A single `<select>` of the world's templates, assigned via the same PATCH as any other node field. */
function TemplatePicker({
  node,
  onChanged,
  onClose,
}: {
  node: NodeDetail;
  onChanged: () => void;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  const { data } = useQuery({ queryKey: ["templates", node.worldId], queryFn: () => api.templates(node.worldId) });
  const templates = data?.templates ?? [];
  const [templateId, setTemplateId] = useState(node.templateId);

  const set = useMutation({
    mutationFn: () => api.updateNode(node.id, { templateId }),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  return (
    <div className="modal-backdrop pt-[8vh]" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-fg-strong">Template</h2>
        <select
          value={templateId ?? ""}
          onChange={(e) => setTemplateId(e.target.value.length > 0 ? e.target.value : null)}
          className="mb-4 w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-sm text-fg"
        >
          <option value="">None</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.icon ?? "📋"} {t.name}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-soft hover:bg-press"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => set.mutate()}
            disabled={set.isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {set.isPending ? "Setting…" : "Set"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Backlinks({
  node,
  allNodes,
  onCreateNamed,
  mobileOpen,
  onCloseMobile,
}: {
  node: NodeDetail;
  allNodes: NodeSummary[];
  onCreateNamed: (title: string) => void;
  /** Below the lg breakpoint the panel is a right-hand drawer; this says whether it's open. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const wanted = useQuery({
    queryKey: ["unresolved", node.worldId],
    queryFn: () => api.unresolvedLinks(node.worldId),
  });
  const links = wanted.data?.links ?? [];
  const panel = useResizablePanel({ storageKey: "dwa:rightPanel", defaultWidth: 280, minWidth: 220, maxWidth: 480 });

  if (panel.collapsed && !mobileOpen) {
    return (
      <aside className="hidden h-full w-8 shrink-0 flex-col items-center border-l border-divider bg-panel py-3 lg:flex">
        <button
          type="button"
          onClick={panel.toggleCollapsed}
          className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
          title="Show panel"
          aria-label="Show panel"
        >
          «
        </button>
      </aside>
    );
  }

  return (
    <>
    {mobileOpen && (
      <div className="fixed inset-0 z-[2044] bg-black/50 lg:hidden" onClick={onCloseMobile} aria-hidden="true" />
    )}
    <aside
      style={{ width: panel.width }}
      className={[
        "relative h-full shrink-0 overflow-y-auto border-l border-divider bg-panel px-4 py-4 lg:block",
        mobileOpen
          ? "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-[2045] max-lg:w-[85vw]! max-lg:max-w-sm max-lg:shadow-pop"
          : "hidden",
      ].join(" ")}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        tabIndex={0}
        onPointerDown={(e) => panel.startResize(e, "right")}
        onDoubleClick={panel.resetWidth}
        onKeyDown={(e) => panel.handleKeyDown(e, "right")}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-line-strong focus:bg-line-strong focus:outline-none"
      />
      <button
        type="button"
        onClick={panel.toggleCollapsed}
        className="absolute right-2 top-2 hidden rounded p-1 text-fg-muted hover:bg-hover hover:text-fg lg:block"
        title="Hide panel"
        aria-label="Hide panel"
      >
        »
      </button>
      <button
        type="button"
        onClick={onCloseMobile}
        className="absolute right-2 top-2 rounded p-1 text-fg-muted hover:bg-hover hover:text-fg lg:hidden"
        aria-label="Close panel"
      >
        ✕
      </button>
      {node.tags.length > 0 && (
        <>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Tags</h2>
          <div className="mb-6 flex flex-wrap gap-1.5">
            {node.tags.map((tag) => (
              <a
                key={tag.id}
                href={`/n/${tag.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/n/${tag.id}`);
                }}
                className="tag-chip"
              >
                #{tag.title}
              </a>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Mentioned in
      </h2>
      {node.backlinks.length === 0 ? (
        <p className="text-xs text-fg-faint">Nothing links here yet.</p>
      ) : (
        <ul className="space-y-1">
          {node.backlinks.map((link) => (
            <li key={`${link.nodeId}-${link.label ?? ""}`}>
              <button
                type="button"
                onClick={() => navigate(`/n/${link.nodeId}`)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-fg-soft hover:bg-hover"
              >
                <span>{link.icon ?? "📄"}</span>
                <span className="truncate">{link.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {links.length > 0 && (
        <>
          <h2 className="mb-1 mt-6 text-xs font-medium uppercase tracking-wide text-fg-muted">
            Wanted pages
          </h2>
          <p className="mb-2 text-[10px] text-fg-faint">
            Linked to, but not written yet. Click to create.
          </p>
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.targetText}>
                <button
                  type="button"
                  onClick={() => onCreateNamed(link.targetText)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-danger-soft hover:bg-hover"
                >
                  <span className="truncate">{link.targetText}</span>
                  {link.count > 1 && (
                    <span className="ml-auto text-[10px] text-fg-faint">{link.count}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <FieldsPanel node={node} allNodes={allNodes} />

      <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-fg-muted">Page</h2>
      <dl className="space-y-1 text-xs text-fg-subtle">
        <div className="flex justify-between">
          <dt>Kind</dt>
          <dd className="text-fg-soft">{node.kind}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Visibility</dt>
          <dd className={VISIBILITY_CLASS[node.visibility].split(" ")[0]}>{VISIBILITY_LABEL[node.visibility]}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Children</dt>
          <dd className="text-fg-soft">{node.children.length}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Updated</dt>
          <dd className="text-fg-soft">{new Date(node.updatedAt).toLocaleDateString()}</dd>
        </div>
      </dl>
      <p className="mt-4 break-all text-[10px] text-fg-faint">id {node.id}</p>
    </aside>
    </>
  );
}

/** A gold dot marking a DM-only field, matching Sidebar's DM-only page marker. */
function DmDot() {
  return (
    <span className="text-[10px] text-secret" title="DM only">
      ●
    </span>
  );
}

/** Matches createFieldInputSchema: every type except `select`, whose options only ever come from a template. */
type AddableFieldType = Exclude<FieldType, "select">;
const ADDABLE_FIELD_TYPES: AddableFieldType[] = [
  "text",
  "longtext",
  "number",
  "checkbox",
  "date",
  "link",
  "section",
];

/**
 * Typed field values, seeded by a template but freely editable/addable
 * afterward — same house style as the title field above: no Edit/Save
 * toggle, autosave on blur or on change depending on the control.
 */
function FieldsPanel({ node, allNodes }: { node: NodeDetail; allNodes: NodeSummary[] }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["fields", node.id], queryFn: () => api.fields(node.id) });
  const fields = data?.fields ?? [];
  const [addingOpen, setAddingOpen] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["fields", node.id] });

  const save = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: FieldDto["value"] }) =>
      api.updateField(node.id, fieldId, { value }),
    onSuccess: invalidate,
  });

  if (fields.length === 0 && !node.canEdit) return null;

  return (
    <div className="mt-6">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Fields</h2>
      <dl className="space-y-1.5">
        {fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            allNodes={allNodes}
            canEdit={node.canEdit}
            onSave={(value) => save.mutate({ fieldId: field.id, value })}
          />
        ))}
        {fields.length === 0 && <p className="text-xs text-fg-faint">No fields on this page.</p>}
      </dl>

      {node.canEdit &&
        (addingOpen ? (
          <AddFieldForm
            nodeId={node.id}
            onDone={() => {
              setAddingOpen(false);
              invalidate();
            }}
            onCancel={() => setAddingOpen(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingOpen(true)}
            className="mt-2 rounded px-1.5 py-1 text-xs text-fg-muted hover:bg-hover hover:text-fg"
          >
            + Add a field
          </button>
        ))}
    </div>
  );
}

function FieldRow({
  field,
  allNodes,
  canEdit,
  onSave,
}: {
  field: FieldDto;
  allNodes: NodeSummary[];
  canEdit: boolean;
  onSave: (value: FieldDto["value"]) => void;
}) {
  const [text, setText] = useState(field.value === null ? "" : String(field.value));

  if (field.type === "section") {
    return (
      <div className="mt-3 flex items-center gap-1 border-b border-selected pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
        {field.label}
        {field.visibility === "dm" && <DmDot />}
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <dt className="flex shrink-0 items-center gap-1 pt-1 text-fg-subtle">
        {field.label}
        {field.visibility === "dm" && <DmDot />}
      </dt>
      <dd className="min-w-0 flex-1 text-right">
        {field.type === "checkbox" ? (
          <input
            type="checkbox"
            checked={field.value === true}
            disabled={!canEdit}
            onChange={(e) => onSave(e.target.checked)}
          />
        ) : field.type === "select" ? (
          <select
            value={typeof field.value === "string" ? field.value : ""}
            disabled={!canEdit}
            onChange={(e) => onSave(e.target.value.length > 0 ? e.target.value : null)}
            className="w-full rounded border border-line bg-canvas px-1.5 py-0.5 text-right text-fg disabled:opacity-70"
          >
            <option value="">—</option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : field.type === "date" ? (
          <input
            type="date"
            value={typeof field.value === "string" ? field.value : ""}
            disabled={!canEdit}
            onChange={(e) => onSave(e.target.value.length > 0 ? e.target.value : null)}
            className="rounded border border-line bg-canvas px-1.5 py-0.5 text-fg disabled:opacity-70"
          />
        ) : field.type === "link" ? (
          <div className="flex items-center justify-end gap-1">
            {field.refNode !== null && field.refNode !== undefined && (
              <button
                type="button"
                onClick={() => navigate(`/n/${field.refNode!.id}`)}
                className="truncate rounded bg-hover px-1.5 py-0.5 text-fg-soft hover:bg-hover-strong"
              >
                {field.refNode.icon ?? "📄"} {field.refNode.title}
              </button>
            )}
            {canEdit && (
              <select
                value={typeof field.value === "string" ? field.value : ""}
                onChange={(e) => onSave(e.target.value.length > 0 ? e.target.value : null)}
                className="min-w-0 rounded border border-line bg-canvas px-1 py-0.5 text-fg"
              >
                <option value="">—</option>
                {allNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : field.type === "longtext" ? (
          <textarea
            value={text}
            disabled={!canEdit}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => onSave(text.length > 0 ? text : null)}
            rows={2}
            className="w-full resize-y rounded border border-line bg-canvas px-1.5 py-1 text-right text-fg outline-none focus:border-line-strong disabled:opacity-70"
          />
        ) : (
          <input
            type={field.type === "number" ? "number" : "text"}
            value={text}
            disabled={!canEdit}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => onSave(text.length === 0 ? null : field.type === "number" ? Number(text) : text)}
            className="w-full rounded border border-line bg-canvas px-1.5 py-0.5 text-right text-fg outline-none focus:border-line-strong disabled:opacity-70"
          />
        )}
      </dd>
    </div>
  );
}

function AddFieldForm({
  nodeId,
  onDone,
  onCancel,
}: {
  nodeId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState("");
  const [type, setType] = useState<AddableFieldType>("text");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createField(nodeId, { key, type, visibility: "members" }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not add that field."),
  });

  return (
    <form
      className="mt-2 flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim().length > 0) create.mutate();
      }}
    >
      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="key"
        autoFocus
        className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-1 font-mono text-xs text-fg outline-none focus:border-line-strong"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as AddableFieldType)}
        className="shrink-0 rounded border border-line bg-canvas px-1 py-1 text-xs text-fg"
      >
        {ADDABLE_FIELD_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button type="submit" disabled={create.isPending} className="shrink-0 text-xs text-success hover:text-success">
        Add
      </button>
      <button type="button" onClick={onCancel} className="shrink-0 text-xs text-fg-muted hover:text-fg">
        ✕
      </button>
      {error !== null && <p className="w-full text-[10px] text-danger">{error}</p>}
    </form>
  );
}
