import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { NodeSummary } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { renderMarkdown } from "../lib/markdown.ts";

/**
 * The anonymous half of a share link: no session, no sidebar chrome, no edit
 * affordances — just the shared page's subtree, read-only. Navigation within
 * it is client-side state rather than real URLs; a share link always points
 * at one root, and deep-linking into a specific sub-page was not worth the
 * extra plumbing for a first cut. See docs/PLAN.md §5 and services/shareLinks.ts.
 */
export function ShareView({ token }: { token: string }) {
  const tree = useQuery({
    queryKey: ["share-tree", token],
    queryFn: () => api.sharedTree(token),
  });
  const [activeId, setActiveId] = useState<string | null>(null);

  if (tree.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-[#7a7d86]">Loading…</div>
    );
  }
  if (tree.isError || tree.data === undefined) {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center text-sm text-[#7a7d86]">
        This link is not valid, or it has been revoked.
      </div>
    );
  }

  const { rootId, nodes } = tree.data;
  const currentId = activeId ?? rootId;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-[#26282d] bg-[#1a1c20] px-3 py-4">
        <p className="mb-3 px-1 text-[10px] uppercase tracking-wide text-[#6b6e77]">Shared with you</p>
        <ShareTree nodes={nodes} rootId={rootId} activeId={currentId} onSelect={setActiveId} />
      </aside>
      <ShareNode token={token} nodeId={currentId} allNodes={nodes} onNavigate={setActiveId} />
    </div>
  );
}

function ShareTree({
  nodes,
  rootId,
  activeId,
  onSelect,
}: {
  nodes: NodeSummary[];
  rootId: string;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const byParent = useMemo(() => {
    const map = new Map<string | null, NodeSummary[]>();
    for (const node of nodes) {
      const key = node.id === rootId ? "__root__" : node.parentId;
      const list = map.get(key) ?? [];
      list.push(node);
      map.set(key, list);
    }
    return map;
  }, [nodes, rootId]);

  const root = nodes.find((n) => n.id === rootId);
  if (root === undefined) return null;

  return (
    <ul className="space-y-0.5 text-sm">
      <ShareTreeItem node={root} depth={0} byParent={byParent} activeId={activeId} onSelect={onSelect} />
    </ul>
  );
}

function ShareTreeItem({
  node,
  depth,
  byParent,
  activeId,
  onSelect,
}: {
  node: NodeSummary;
  depth: number;
  byParent: Map<string | null, NodeSummary[]>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const children = byParent.get(node.id) ?? [];
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left ${
          node.id === activeId ? "bg-[#26282e] text-[#f0f1f4]" : "text-[#b6b8bf] hover:bg-[#232529]"
        }`}
      >
        <span>{node.icon ?? "📄"}</span>
        <span className="truncate">{node.title}</span>
      </button>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <ShareTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              byParent={byParent}
              activeId={activeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ShareNode({
  token,
  nodeId,
  allNodes,
  onNavigate,
}: {
  token: string;
  nodeId: string;
  allNodes: NodeSummary[];
  onNavigate: (id: string) => void;
}) {
  const detail = useQuery({
    queryKey: ["share-node", token, nodeId],
    queryFn: () => api.sharedNode(token, nodeId),
  });

  const html = useMemo(
    () => (detail.data === undefined ? "" : renderMarkdown(detail.data.node.bodyMd, allNodes)),
    [detail.data, allNodes],
  );

  if (detail.data === undefined) {
    return <div className="flex-1 overflow-y-auto px-8 py-6 text-sm text-[#7a7d86]">Loading…</div>;
  }
  const node = detail.data.node;

  function onBodyClick(event: ReactMouseEvent<HTMLDivElement>): void {
    const target = (event.target as HTMLElement).closest("a");
    const nodeId = target?.getAttribute("data-node");
    if (nodeId !== null && nodeId !== undefined) {
      event.preventDefault();
      onNavigate(nodeId);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 py-6">
        {node.breadcrumb.length > 0 && (
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-[#7a7d86]">
            {node.breadcrumb.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <button type="button" onClick={() => onNavigate(crumb.id)} className="hover:text-[#d7d8dc]">
                  {crumb.icon ?? "📄"} {crumb.title}
                </button>
                <span className="text-[#4a4d55]">/</span>
              </span>
            ))}
          </nav>
        )}

        <h1 className="mb-4 text-2xl font-semibold text-[#f0f1f4]">
          {node.icon ?? "📄"} {node.title}
        </h1>

        <div className="prose-body text-[15px]" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />

        {node.children.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">Pages inside</h2>
            <ul className="grid gap-1 sm:grid-cols-2">
              {node.children.map((child) => (
                <li key={child.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(child.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[#b6b8bf] hover:bg-[#232529]"
                  >
                    <span>{child.icon ?? "📄"}</span>
                    <span className="truncate">{child.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
