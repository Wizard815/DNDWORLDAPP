import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, MouseEvent as ReactMouseEvent } from "react";
import type { NodeDetail, NodeSummary, Visibility } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { navigate } from "../lib/nav.ts";
import { IconPicker } from "./IconPicker.tsx";
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
  onChanged: () => void;
  onCreateChild: (parentId: string) => void;
  onCreateNamed: (title: string) => void;
  onArchive: (node: NodeDetail) => void;
}

export function NodeView({
  node,
  allNodes,
  onChanged,
  onCreateChild,
  onCreateNamed,
  onArchive,
}: Props) {
  const [title, setTitle] = useState(node.title);
  const [body, setBody] = useState(node.bodyMd);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<NodeSummary[]>([]);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // NOTE: there is deliberately no effect syncing local state back from `node`.
  // App renders this component with key={node.id}, so navigating remounts it with
  // fresh state. An effect keyed on node.title/node.bodyMd would fire on every
  // autosave — throwing the writer out of the editor a second after they pause.

  const dirty = title !== node.title || body !== node.bodyMd;

  const save = useCallback(async () => {
    if (!dirty) return;
    setSaveState("saving");
    await api.updateNode(node.id, { title, bodyMd: body });
    setSaveState("saved");
    onChanged();
    window.setTimeout(() => setSaveState("idle"), 1200);
  }, [dirty, node.id, title, body, onChanged]);

  // Autosave: quiet for 800ms means "done typing".
  useEffect(() => {
    if (!dirty) return;
    const handle = window.setTimeout(() => {
      void save();
    }, 800);
    return () => window.clearTimeout(handle);
  }, [dirty, save]);

  const html = useMemo(() => renderMarkdown(body, allNodes), [body, allNodes]);

  /** Intercept wiki links so they navigate in-app, and offer to create missing pages. */
  function onBodyClick(event: ReactMouseEvent<HTMLDivElement>): void {
    const target = (event.target as HTMLElement).closest("a");
    if (target === null) return;
    const nodeId = target.getAttribute("data-node");
    const missing = target.getAttribute("data-missing");
    if (nodeId !== null) {
      event.preventDefault();
      navigate(`/n/${nodeId}`);
    } else if (missing !== null) {
      event.preventDefault();
      onCreateNamed(missing);
    }
  }

  function insertAtCursor(text: string): void {
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? body.length;
    const next = `${body.slice(0, caret)}${text}${body.slice(caret)}`;
    setBody(next);
    requestAnimationFrame(() => {
      const position = caret + text.length;
      textarea?.focus();
      textarea?.setSelectionRange(position, position);
    });
  }

  async function uploadAndInsert(file: File): Promise<void> {
    setUploading(true);
    setUploadError(null);
    try {
      const asset = await api.uploadAsset(node.worldId, file);
      insertAtCursor(`\n![${asset.origName}](${asset.url})\n`);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  /** Pasting or dropping an image uploads it and drops in the markdown. */
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const file = [...event.clipboardData.files].find((f) => f.type.startsWith("image/"));
    if (file === undefined) return;
    event.preventDefault();
    void uploadAndInsert(file);
  }

  function onDropFile(event: DragEvent<HTMLTextAreaElement>): void {
    const file = [...event.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (file === undefined) return;
    event.preventDefault();
    void uploadAndInsert(file);
  }

  /** `[[` autocomplete over every page in the world. */
  function refreshSuggestions(value: string, caret: number): void {
    const before = value.slice(0, caret);
    const open = before.lastIndexOf("[[");
    if (open === -1 || before.slice(open).includes("]]")) {
      setSuggestions([]);
      return;
    }
    const query = before.slice(open + 2).toLowerCase();
    if (query.includes("\n")) {
      setSuggestions([]);
      return;
    }
    const matches = allNodes
      .filter((n) => n.id !== node.id && n.title.toLowerCase().includes(query))
      .slice(0, 8);
    setSuggestions(matches);
    setSuggestIndex(0);
  }

  function applySuggestion(chosen: NodeSummary): void {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const caret = textarea.selectionStart;
    const before = body.slice(0, caret);
    const open = before.lastIndexOf("[[");
    if (open === -1) return;
    const next = `${body.slice(0, open)}[[${chosen.title}]]${body.slice(caret)}`;
    setBody(next);
    setSuggestions([]);
    requestAnimationFrame(() => {
      const position = open + chosen.title.length + 4;
      textarea.focus();
      textarea.setSelectionRange(position, position);
    });
  }

  async function patch(input: Parameters<typeof api.updateNode>[1]): Promise<void> {
    await api.updateNode(node.id, input);
    onChanged();
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
              onBlur={() => void save()}
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
            {node.canEdit && (
              <button
                type="button"
                onClick={() => {
                  if (editing) void save();
                  setEditing(!editing);
                }}
                className="rounded border border-[#33363d] px-2 py-1 text-xs text-[#8d9099] hover:text-[#d7d8dc]"
              >
                {editing ? "Preview" : "Edit"}
              </button>
            )}
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
                          onCreateChild(node.id);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                      >
                        Add a page inside
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

          {editing ? (
            <div className="relative">
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="rounded border border-[#33363d] px-2 py-1 text-xs text-[#8d9099] hover:text-[#d7d8dc] disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Insert image"}
                </button>
                <span className="text-[10px] text-[#6b6e77]">
                  or paste / drop an image straight into the editor
                </span>
                {uploadError !== null && (
                  <span className="text-[10px] text-[#e0888a]">{uploadError}</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file !== undefined) void uploadAndInsert(file);
                  e.target.value = "";
                }}
              />
              <textarea
                ref={textareaRef}
                value={body}
                onPaste={onPaste}
                onDrop={onDropFile}
                onChange={(e) => {
                  setBody(e.target.value);
                  refreshSuggestions(e.target.value, e.target.selectionStart);
                }}
                onKeyDown={(e) => {
                  if (suggestions.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSuggestIndex((i) => (i + 1) % suggestions.length);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSuggestIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                  } else if (e.key === "Enter" || e.key === "Tab") {
                    const chosen = suggestions[suggestIndex];
                    if (chosen !== undefined) {
                      e.preventDefault();
                      applySuggestion(chosen);
                    }
                  } else if (e.key === "Escape") {
                    setSuggestions([]);
                  }
                }}
                placeholder="Write in Markdown. Link to another page with [[double brackets]]."
                className="min-h-[50vh] w-full resize-none rounded-md border border-[#2c2f36] bg-[#1b1d21] p-4 font-mono text-sm leading-relaxed outline-none focus:border-[#3f434b]"
              />
              {suggestions.length > 0 && (
                <ul className="absolute right-2 top-12 z-10 w-64 overflow-hidden rounded-md border border-[#33363d] bg-[#22242a] shadow-lg">
                  {suggestions.map((s, index) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applySuggestion(s);
                        }}
                        className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${
                          index === suggestIndex ? "bg-[#2f333b] text-[#f0f1f4]" : "text-[#b6b8bf]"
                        }`}
                      >
                        <span>{s.icon ?? "📄"}</span>
                        <span className="truncate">{s.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div
              className="prose-body text-[15px]"
              onClick={onBodyClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          <Posts nodeId={node.id} canEdit={node.canEdit} allNodes={allNodes} />

          {node.children.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">
                Pages inside
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
            onClick={() => onCreateChild(node.id)}
            className="mt-4 rounded px-2 py-1.5 text-xs text-[#7a7d86] hover:bg-[#232529] hover:text-[#d7d8dc]"
          >
            + Add a page inside {node.title}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Backlinks({
  node,
  onCreateNamed,
}: {
  node: NodeDetail;
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
          <dt>Pages inside</dt>
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
