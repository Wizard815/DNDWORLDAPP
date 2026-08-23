import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { MoveNodeInput, NodeDetail, NodeKind } from "@dndworldapp/schema";
import { ApiError, api, setViewAsPlayer } from "./api.ts";
import { AuthScreen } from "./components/Auth.tsx";
import { CreateChooser } from "./components/CreateChooser.tsx";
import { Members } from "./components/Members.tsx";
import { Backlinks, NodeView } from "./components/NodeView.tsx";
import { PinnedStrip } from "./components/PinnedStrip.tsx";
import { QuickSwitcher } from "./components/QuickSwitcher.tsx";
import { ShareView } from "./components/ShareView.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Templates } from "./components/Templates.tsx";
import { Tokens } from "./components/Tokens.tsx";
import { navigate, nodeIdFromPath, usePath } from "./lib/nav.ts";

function shareTokenFromPath(path: string): string | null {
  const match = /^\/share\/([a-f0-9]+)/.exec(path);
  return match?.[1] ?? null;
}

/**
 * Manually pinned pages — a personal view preference, not campaign content, so it's
 * client-side-only, same reasoning Sidebar.tsx's own expand/collapse state uses.
 */
function usePinned(worldId: string) {
  const storageKey = `dwa:pinned:${worldId}`;
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return new Set<string>(raw !== null ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify([...pinnedIds]));
  }, [pinnedIds, storageKey]);

  const togglePin = useCallback((nodeId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  return { pinnedIds, togglePin };
}

export function App() {
  const queryClient = useQueryClient();
  const path = usePath();
  const shareToken = shareTokenFromPath(path);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [viewAsPlayer, setViewAsPlayerState] = useState(false);
  const [createChooser, setCreateChooser] = useState<{ parentId: string | null } | null>(null);

  const session = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });

  const setupStatus = useQuery({
    queryKey: ["setup"],
    queryFn: () => api.setupStatus(),
    enabled: session.data === null,
  });

  const worlds = useQuery({
    queryKey: ["worlds"],
    queryFn: () => api.worlds(),
    enabled: session.data != null,
  });

  const world = worlds.data?.worlds[0] ?? null;
  const { pinnedIds, togglePin } = usePinned(world?.id ?? "");

  const tree = useQuery({
    queryKey: ["tree", world?.id],
    queryFn: () => api.tree(world!.id),
    enabled: world !== null,
  });

  const activeId = nodeIdFromPath(path);

  const node = useQuery({
    queryKey: ["node", activeId],
    queryFn: () => api.node(activeId!),
    enabled: activeId !== null,
  });

  // Land on the world's root page when no page is addressed. Never while a
  // share link is open — an already-signed-in DM opening their own share
  // link in the same browser must see the anonymous view, not get bounced
  // back to their own dashboard by this effect (it runs regardless of which
  // branch below actually gets rendered).
  useEffect(() => {
    if (shareToken === null && activeId === null && world?.rootNodeId != null) {
      navigate(`/n/${world.rootNodeId}`);
    }
  }, [shareToken, activeId, world]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSwitcherOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Flips the module-level flag api.ts reads on every request, then throws away
   * everything cached so far — a stale "what I could edit" from before the
   * toggle would be actively misleading, not just outdated.
   */
  const toggleViewAsPlayer = useCallback(() => {
    setViewAsPlayerState((prev) => {
      setViewAsPlayer(!prev);
      void queryClient.invalidateQueries();
      return !prev;
    });
  }, [queryClient]);

  const refreshTree = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["tree"] });
    void queryClient.invalidateQueries({ queryKey: ["node"] });
    // Writing a page can satisfy a wanted link, or create new ones.
    void queryClient.invalidateQueries({ queryKey: ["unresolved"] });
  }, [queryClient]);

  const createNode = useMutation({
    mutationFn: ({
      parentId,
      title,
      kind,
      templateId,
    }: {
      parentId: string | null;
      title?: string;
      kind?: NodeKind;
      templateId?: string;
    }) => api.createNode(world!.id, { title: title ?? "Untitled", parentId, kind, templateId }),
    onSuccess: (result) => {
      refreshTree();
      navigate(`/n/${result.node.id}`);
    },
  });

  const moveNode = useMutation({
    mutationFn: ({ nodeId, input }: { nodeId: string; input: MoveNodeInput }) =>
      api.moveNode(nodeId, input),
    onSuccess: refreshTree,
  });

  /** Archiving takes the subtree with it, so ask first, then fall back to the parent. */
  const archiveNode = useCallback(
    (target: NodeDetail) => {
      const inside =
        target.children.length > 0 ? ` and the ${target.children.length} page(s) inside it` : "";
      if (!window.confirm(`Archive "${target.title}"${inside}?`)) return;
      void api.archiveNode(target.id).then(() => {
        const parent = target.breadcrumb.at(-1)?.id ?? world?.rootNodeId ?? null;
        if (parent !== null) navigate(`/n/${parent}`);
        refreshTree();
      });
    },
    [refreshTree, world],
  );

  // A share link needs no session at all — rendered after the hooks above
  // (so their call count stays fixed every render) but before anything that
  // assumes a signed-in user exists.
  if (shareToken !== null) {
    return <ShareView token={shareToken} />;
  }

  if (session.isLoading) {
    return <div className="p-8 text-sm text-[#7a7d86]">Loading…</div>;
  }

  if (session.data == null) {
    return (
      <AuthScreen
        needsSetup={setupStatus.data?.needsSetup ?? false}
        onDone={() => {
          void queryClient.invalidateQueries();
        }}
      />
    );
  }

  if (world === null) {
    return <div className="p-8 text-sm text-[#7a7d86]">No world yet.</div>;
  }

  const nodes = tree.data?.nodes ?? [];
  const isGameMaster = world.role === "owner" || world.role === "dm";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <PinnedStrip nodes={nodes} pinnedIds={pinnedIds} activeId={activeId} onUnpin={togglePin} />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          worldName={world.name}
          nodes={nodes}
          activeId={activeId}
          onOpenCreateChooser={(parentId) => setCreateChooser({ parentId })}
          onMove={(nodeId, input) => moveNode.mutate({ nodeId, input })}
          onChanged={refreshTree}
          pinnedIds={pinnedIds}
          onTogglePin={togglePin}
          onOpenSwitcher={() => setSwitcherOpen(true)}
          onOpenTokens={() => setTokensOpen(true)}
          onOpenMembers={() => setMembersOpen(true)}
          onOpenTemplates={() => setTemplatesOpen(true)}
          isGameMaster={isGameMaster}
          viewAsPlayer={viewAsPlayer}
          onToggleViewAsPlayer={toggleViewAsPlayer}
          onSignOut={() => {
            setViewAsPlayer(false);
            setViewAsPlayerState(false);
            void api.logout().then(() => queryClient.invalidateQueries());
          }}
        />

        {node.data !== undefined ? (
          <>
            <NodeView
              key={node.data.node.id}
              node={node.data.node}
              allNodes={nodes}
              isGameMaster={isGameMaster}
              onChanged={refreshTree}
              onOpenCreateChooser={(parentId) => setCreateChooser({ parentId })}
              onCreateNamed={(title) =>
                createNode.mutate({ parentId: node.data!.node.id, title })
              }
              onArchive={archiveNode}
              pinnedIds={pinnedIds}
              onTogglePin={togglePin}
            />
            <Backlinks
              node={node.data.node}
              allNodes={nodes}
              onCreateNamed={(title) =>
                createNode.mutate({ parentId: node.data!.node.id, title })
              }
            />
          </>
        ) : (
          <div className="flex-1 p-8 text-sm text-[#7a7d86]">
            {node.isError ? "That page is not available." : "Pick a page."}
          </div>
        )}

        {tokensOpen && (
          <Tokens worldId={world.id} worldName={world.name} onClose={() => setTokensOpen(false)} />
        )}

        {membersOpen && (
          <Members worldId={world.id} canManage={isGameMaster} onClose={() => setMembersOpen(false)} />
        )}

        {templatesOpen && <Templates worldId={world.id} onClose={() => setTemplatesOpen(false)} />}

        {createChooser !== null && (
          <CreateChooser
            worldId={world.id}
            onClose={() => setCreateChooser(null)}
            onCreate={(input) => {
              setCreateChooser(null);
              createNode.mutate({
                parentId: createChooser.parentId,
                title: input.kind === "map" ? "New Map" : "Untitled",
                kind: input.kind,
                templateId: input.templateId,
              });
            }}
          />
        )}

        {switcherOpen && (
          <QuickSwitcher
            worldId={world.id}
            nodes={nodes}
            onClose={() => setSwitcherOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
