import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { NodeDetail, NodeSummary, Visibility } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { navigate } from "../lib/nav.ts";
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
}

export function NodeView({ node, allNodes, onChanged, onCreateChild, onCreateNamed }: Props) {
  const [title, setTitle] = useState(node.title);
  const [body, setBody] = useState(node.bodyMd);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<NodeSummary[]>([]);
  const [suggestIndex, setSuggestIndex] = useState(0);

  // Reset local state when navigating to a different page.
  useEffect(() => {
    setTitle(node.title);
    setBody(node.bodyMd);
    setEditing(false);
    setSuggestions([]);
  }, [node.id, node.title, node.bodyMd]);

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

  async function setVisibility(visibility: Visibility): Promise<void> {
    await api.updateNode(node.id, { visibility });
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
          <div className="mb-4 flex items-center gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void save()}
              disabled={!node.canEdit}
              className="min-w-0 flex-1 bg-transparent text-2xl font-semibold text-[#f0f1f4] outline-none disabled:opacity-80"
            />
            <select
              value={node.visibility}
              onChange={(e) => void setVisibility(e.target.value as Visibility)}
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
          </div>

          {editing ? (
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={body}
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
                <ul className="absolute right-2 top-2 z-10 w-64 overflow-hidden rounded-md border border-[#33363d] bg-[#22242a] shadow-lg">
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

export function Backlinks({ node }: { node: NodeDetail }) {
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

      <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">
        Page
      </h2>
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
