import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FieldDto, FieldType, NodeDetail, NodeSummary, Visibility } from "@dndworldapp/schema";
import { ApiError, api } from "../api.ts";
import { Editor } from "../editor/Editor.tsx";
import { navigate } from "../lib/nav.ts";
import { Access } from "./Access.tsx";
import { IconPicker } from "./IconPicker.tsx";
import { MapView } from "./MapView.tsx";
import { Posts } from "./Posts.tsx";

const VISIBILITY_LABEL: Record<Visibility, string> = {
  public: "Public",
  members: "Players",
  dm: "DM only",
  private: "Just me",
};

export const VISIBILITY_CLASS: Record<Visibility, string> = {
  public: "text-[#7fb08a] border-[#3c5c43]",
  members: "text-[#8d9099] border-[#3a3d44]",
  dm: "text-[#c9a227] border-[#5c5023]",
  private: "text-[#a98bc9] border-[#4b3c5c]",
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
      <header className="border-b border-[#26282d] px-8 py-3">
        <nav className="flex flex-wrap items-center gap-1 text-xs text-[#7a7d86]">
          {node.breadcrumb.map((crumb) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => navigate(`/n/${crumb.id}`)}
                className="hover:text-[#d7d8dc]"
              >
                {crumb.icon ?? "📄"} {crumb.title}
              </button>
              <span className="text-[#4a4d55]">/</span>
            </span>
          ))}
          <span className="text-[#b6b8bf]">{node.title}</span>
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-6">
          <div className="mb-4 flex items-center gap-2">
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
              className="min-w-0 flex-1 bg-transparent text-2xl font-semibold text-[#f0f1f4] outline-none disabled:opacity-80"
            />
            <select
              value={node.visibility}
              onChange={(e) => void patch({ visibility: e.target.value as Visibility })}
              disabled={!node.canEdit}
              className={`rounded border bg-[#1d1f23] px-2 py-1 text-xs ${VISIBILITY_CLASS[node.visibility]}`}
              title="Who can see this page"
            >
              {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </option>
              ))}
            </select>
            <span className="w-12 text-right text-[10px] text-[#6b6e77]">
              {saveState === "saving" ? "saving…" : saveState === "saved" ? "saved" : ""}
            </span>

            {node.canEdit && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="rounded border border-[#33363d] px-2 py-1 text-xs text-[#8d9099] hover:text-[#d7d8dc]"
                  aria-label="Page actions"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-md border border-[#33363d] bg-[#22242a] shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenCreateChooser(node.id);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                      >
                        Add a page under…
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onTogglePin(node.id);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
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
                          className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
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
                          className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
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
                          className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
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
                        className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                      >
                        View source…
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onArchive(node);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-[#c98b8b] hover:bg-[#2b2e35]"
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
              className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[8vh]"
              onClick={() => setSourceOpen(false)}
            >
              <div
                className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#33363d] bg-[#1d1f23] p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center">
                  <h2 className="text-base font-semibold text-[#f0f1f4]">Source — {node.title}</h2>
                  <button
                    type="button"
                    onClick={() => setSourceOpen(false)}
                    className="ml-auto text-sm text-[#7a7d86] hover:text-[#d7d8dc]"
                  >
                    Close
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded-md border border-[#2c2f36] bg-[#17181b] p-4 font-mono text-xs text-[#b6b8bf]">
                  {node.bodyMd.length > 0 ? node.bodyMd : "(empty)"}
                </pre>
              </div>
            </div>
          )}

          {node.kind === "map" ? (
            <div className="h-[75vh] overflow-hidden rounded-md border border-[#26282d]">
              <MapView node={node} allNodes={allNodes} />
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
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">
                Child pages
              </h2>
              <ul className="grid gap-1 sm:grid-cols-2">
                {node.children.map((child) => (
                  <li key={child.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/n/${child.id}`)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[#b6b8bf] hover:bg-[#232529]"
                    >
                      <span>{child.icon ?? "📄"}</span>
                      <span className="truncate">{child.title}</span>
                      {child.childCount > 0 && (
                        <span className="ml-auto text-[10px] text-[#6b6e77]">
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
            className="mt-4 rounded px-2 py-1.5 text-xs text-[#7a7d86] hover:bg-[#232529] hover:text-[#d7d8dc]"
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[8vh]" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-[#33363d] bg-[#1d1f23] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-[#f0f1f4]">Template</h2>
        <select
          value={templateId ?? ""}
          onChange={(e) => setTemplateId(e.target.value.length > 0 ? e.target.value : null)}
          className="mb-4 w-full rounded-md border border-[#33363d] bg-[#17181b] px-2 py-1.5 text-sm text-[#d7d8dc]"
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
            className="rounded-md border border-[#33363d] px-3 py-1.5 text-sm text-[#b6b8bf] hover:bg-[#26282e]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => set.mutate()}
            disabled={set.isPending}
            className="rounded-md bg-[#3d5ab5] px-3 py-1.5 text-sm text-white hover:bg-[#4867cc] disabled:opacity-50"
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
}: {
  node: NodeDetail;
  allNodes: NodeSummary[];
  onCreateNamed: (title: string) => void;
}) {
  const wanted = useQuery({
    queryKey: ["unresolved", node.worldId],
    queryFn: () => api.unresolvedLinks(node.worldId),
  });
  const links = wanted.data?.links ?? [];

  return (
    <aside className="hidden h-screen w-[280px] shrink-0 overflow-y-auto border-l border-[#26282d] bg-[#1a1c20] px-4 py-4 lg:block">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">
        Mentioned in
      </h2>
      {node.backlinks.length === 0 ? (
        <p className="text-xs text-[#6b6e77]">Nothing links here yet.</p>
      ) : (
        <ul className="space-y-1">
          {node.backlinks.map((link) => (
            <li key={`${link.nodeId}-${link.label ?? ""}`}>
              <button
                type="button"
                onClick={() => navigate(`/n/${link.nodeId}`)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[#b6b8bf] hover:bg-[#232529]"
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
          <h2 className="mb-1 mt-6 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">
            Wanted pages
          </h2>
          <p className="mb-2 text-[10px] text-[#6b6e77]">
            Linked to, but not written yet. Click to create.
          </p>
          <ul className="space-y-1">
            {links.map((link) => (
              <li key={link.targetText}>
                <button
                  type="button"
                  onClick={() => onCreateNamed(link.targetText)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[#c98b8b] hover:bg-[#232529]"
                >
                  <span className="truncate">{link.targetText}</span>
                  {link.count > 1 && (
                    <span className="ml-auto text-[10px] text-[#6b6e77]">{link.count}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <FieldsPanel node={node} allNodes={allNodes} />

      <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">Page</h2>
      <dl className="space-y-1 text-xs text-[#8d9099]">
        <div className="flex justify-between">
          <dt>Kind</dt>
          <dd className="text-[#b6b8bf]">{node.kind}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Visibility</dt>
          <dd className={VISIBILITY_CLASS[node.visibility].split(" ")[0]}>{node.visibility}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Children</dt>
          <dd className="text-[#b6b8bf]">{node.children.length}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Updated</dt>
          <dd className="text-[#b6b8bf]">{new Date(node.updatedAt).toLocaleDateString()}</dd>
        </div>
      </dl>
      <p className="mt-4 break-all text-[10px] text-[#5c5f67]">id {node.id}</p>
    </aside>
  );
}

/** A gold dot marking a DM-only field, matching Sidebar's DM-only page marker. */
function DmDot() {
  return (
    <span className="text-[10px] text-[#c9a227]" title="DM only">
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
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">Fields</h2>
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
        {fields.length === 0 && <p className="text-xs text-[#6b6e77]">No fields on this page.</p>}
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
            className="mt-2 rounded px-1.5 py-1 text-xs text-[#7a7d86] hover:bg-[#232529] hover:text-[#d7d8dc]"
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
      <div className="mt-3 flex items-center gap-1 border-b border-[#2c2f36] pb-1 text-[10px] font-medium uppercase tracking-wide text-[#7a7d86]">
        {field.label}
        {field.visibility === "dm" && <DmDot />}
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <dt className="flex shrink-0 items-center gap-1 pt-1 text-[#8d9099]">
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
            className="w-full rounded border border-[#33363d] bg-[#17181b] px-1.5 py-0.5 text-right text-[#d7d8dc] disabled:opacity-70"
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
            className="rounded border border-[#33363d] bg-[#17181b] px-1.5 py-0.5 text-[#d7d8dc] disabled:opacity-70"
          />
        ) : field.type === "link" ? (
          <div className="flex items-center justify-end gap-1">
            {field.refNode !== null && field.refNode !== undefined && (
              <button
                type="button"
                onClick={() => navigate(`/n/${field.refNode!.id}`)}
                className="truncate rounded bg-[#232529] px-1.5 py-0.5 text-[#b6b8bf] hover:bg-[#2b2e35]"
              >
                {field.refNode.icon ?? "📄"} {field.refNode.title}
              </button>
            )}
            {canEdit && (
              <select
                value={typeof field.value === "string" ? field.value : ""}
                onChange={(e) => onSave(e.target.value.length > 0 ? e.target.value : null)}
                className="min-w-0 rounded border border-[#33363d] bg-[#17181b] px-1 py-0.5 text-[#d7d8dc]"
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
            className="w-full resize-y rounded border border-[#33363d] bg-[#17181b] px-1.5 py-1 text-right text-[#d7d8dc] outline-none focus:border-[#4a4d55] disabled:opacity-70"
          />
        ) : (
          <input
            type={field.type === "number" ? "number" : "text"}
            value={text}
            disabled={!canEdit}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => onSave(text.length === 0 ? null : field.type === "number" ? Number(text) : text)}
            className="w-full rounded border border-[#33363d] bg-[#17181b] px-1.5 py-0.5 text-right text-[#d7d8dc] outline-none focus:border-[#4a4d55] disabled:opacity-70"
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
        className="min-w-0 flex-1 rounded border border-[#33363d] bg-[#17181b] px-1.5 py-1 font-mono text-xs text-[#d7d8dc] outline-none focus:border-[#4a4d55]"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as AddableFieldType)}
        className="shrink-0 rounded border border-[#33363d] bg-[#17181b] px-1 py-1 text-xs text-[#d7d8dc]"
      >
        {ADDABLE_FIELD_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button type="submit" disabled={create.isPending} className="shrink-0 text-xs text-[#7fb08a] hover:text-[#9cc9a6]">
        Add
      </button>
      <button type="button" onClick={onCancel} className="shrink-0 text-xs text-[#7a7d86] hover:text-[#d7d8dc]">
        ✕
      </button>
      {error !== null && <p className="w-full text-[10px] text-[#e0888a]">{error}</p>}
    </form>
  );
}
