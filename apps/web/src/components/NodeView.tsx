import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { NodeDetail, NodeSummary, Visibility } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { Editor } from "../editor/Editor.tsx";
import { navigate } from "../lib/nav.ts";
import { Access } from "./Access.tsx";
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
  isGameMaster: boolean;
  onChanged: () => void;
  onCreateChild: (parentId: string) => void;
  onCreateNamed: (title: string) => void;
  onArchive: (node: NodeDetail) => void;
}

export function NodeView({
  node,
  allNodes,
  isGameMaster,
  onChanged,
  onCreateChild,
  onCreateNamed,
  onArchive,
}: Props) {
  const [title, setTitle] = useState(node.title);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

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
                          onCreateChild(node.id);
                        }}
                        className="block w-full px-3 py-2 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
                      >
                        Add a page inside
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
