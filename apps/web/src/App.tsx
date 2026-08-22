import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type { MoveNodeInput, NodeDetail } from "@dndworldapp/schema";
import { ApiError, api } from "./api.ts";
import { AuthScreen } from "./components/Auth.tsx";
import { Members } from "./components/Members.tsx";
import { Backlinks, NodeView } from "./components/NodeView.tsx";
import { QuickSwitcher } from "./components/QuickSwitcher.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { Tokens } from "./components/Tokens.tsx";
import { navigate, nodeIdFromPath, usePath } from "./lib/nav.ts";

export function App() {
  const queryClient = useQueryClient();
  const path = usePath();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

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

  // Land on the world's root page when no page is addressed.
  useEffect(() => {
    if (activeId === null && world?.rootNodeId != null) {
      navigate(`/n/${world.rootNodeId}`);
    }
  }, [activeId, world]);

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

  const refreshTree = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["tree"] });
    void queryClient.invalidateQueries({ queryKey: ["node"] });
    // Writing a page can satisfy a wanted link, or create new ones.
    void queryClient.invalidateQueries({ queryKey: ["unresolved"] });
  }, [queryClient]);

  const createNode = useMutation({
    mutationFn: ({ parentId, title }: { parentId: string | null; title?: string }) =>
      api.createNode(world!.id, { title: title ?? "Untitled", parentId }),
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

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        worldName={world.name}
        nodes={nodes}
        activeId={activeId}
        onCreate={(parentId) => createNode.mutate({ parentId })}
        onMove={(nodeId, input) => moveNode.mutate({ nodeId, input })}
        onOpenSwitcher={() => setSwitcherOpen(true)}
        onOpenTokens={() => setTokensOpen(true)}
        onOpenMembers={() => setMembersOpen(true)}
        onSignOut={() => {
          void api.logout().then(() => queryClient.invalidateQueries());
        }}
      />

      {node.data !== undefined ? (
        <>
          <NodeView
            key={node.data.node.id}
            node={node.data.node}
            allNodes={nodes}
            onChanged={refreshTree}
            onCreateChild={(parentId) => createNode.mutate({ parentId })}
            onCreateNamed={(title) =>
              createNode.mutate({ parentId: node.data!.node.id, title })
            }
            onArchive={archiveNode}
          />
          <Backlinks
            node={node.data.node}
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
        <Members
          worldId={world.id}
          canManage={world.role === "owner" || world.role === "dm"}
          onClose={() => setMembersOpen(false)}
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
  );
}
