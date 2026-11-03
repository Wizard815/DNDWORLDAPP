import { DndClient } from "@dndworldapp/dnd-client";
import { useState, useEffect } from "react";
import { Login } from "./components/Login.tsx";
import { TreeView } from "./components/TreeView.tsx";


interface AppState {
  client: DndClient;
  currentWorldId: string | null;
  selectedNodeId: string | null;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [nodes, setNodes] = useState<import("@dndworldapp/schema").NodeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [_error, setError] = useState("");

  async function handleLogin(client: DndClient) {
    setState({ client, currentWorldId: null, selectedNodeId: null });
  }

  async function loadTree(client: DndClient, worldId: string) {
    setLoading(true);
    setError("");
    try {
      const { nodes } = await client.tree(worldId);
      setNodes(nodes);
      setState((prev) => prev ? { ...prev, currentWorldId: worldId } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tree");
    } finally {
      setLoading(false);
    }
  }

  async function handleWorldSelect(worldId: string) {
    if (state) {
      await loadTree(state.client, worldId);
    }
  }

  // World list (shown when no world is selected)
  if (state && !state.currentWorldId) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
          <h1 className="text-lg font-bold">DNDWORLDAPP Desktop</h1>
        </header>
        <main className="p-4">
          <h2 className="text-xl font-semibold mb-4">Select a World</h2>
          {loading && <p>Loading...</p>}
          {!loading && nodes.length === 0 && (
            <WorldPicker onWorldSelect={handleWorldSelect} client={state.client} />
          )}
        </main>
      </div>
    );
  }

  // Tree view (when a world is selected)
  if (state) {
    return (
      <div className="min-h-screen bg-gray-900 text-white">
        <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center gap-2">
          <h1 className="text-lg font-bold">DNDWORLDAPP Desktop</h1>
          {state.currentWorldId && (
            <button
              onClick={() => setState({ ...state, currentWorldId: null, selectedNodeId: null })}
              className="text-xs text-gray-400 hover:text-white ml-auto"
            >
              Switch World
            </button>
          )}
        </header>
        <main className="flex h-[calc(100vh-4rem)]">
          {/* Left: Tree view */}
          <div className="w-1/3 border-r border-gray-700 overflow-y-auto">
            <TreeView
              nodes={nodes}
              selectedId={state.selectedNodeId}
              onSelect={(id) => setState({ ...state, selectedNodeId: id })}
            />
          </div>

          {/* Right: Content area */}
          <div className="w-2/3 p-4 overflow-y-auto">
            {!state.selectedNodeId ? (
              <div className="text-gray-400 text-center py-8">
                <p>Select a node from the tree</p>
              </div>
            ) : (
              <NodeDetail node={state.selectedNodeId} />
            )}
          </div>
        </main>
      </div>
    );
  }

  // Not logged in
  return <Login onSuccess={handleLogin} />;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WorldPicker({ onWorldSelect, client }: {
  onWorldSelect: (worldId: string) => void;
  client: DndClient;
}) {
  const [worlds, setWorlds] = useState<import("@dndworldapp/schema").WorldDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const { worlds } = await client.listWorlds();
        setWorlds(worlds);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to list worlds");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [client]);

  if (loading) return <p className="text-gray-400">Loading worlds...</p>;
  if (error) return <p className="text-red-400">{error}</p>;
  if (worlds.length === 0) return <p className="text-gray-400">No worlds found.</p>;

  return (
    <div className="space-y-2">
      {worlds.map((w) => (
        <div
          key={w.id}
          className="bg-gray-800 p-3 rounded cursor-pointer hover:bg-gray-700"
          onClick={() => onWorldSelect(w.id)}
        >
          <div className="font-medium">{w.name}</div>
          <div className="text-xs text-gray-500">Role: {w.role} • Root: {w.rootNodeId}</div>
        </div>
      ))}
    </div>
  );
}

function NodeDetail({ node }: {
  node: string;
  // client prop removed
}) {
  return (
    <div className="text-gray-400">
      <p>Node: {node}</p>
      <p className="text-sm mt-2">(Full node detail viewer coming in Phase 2)</p>
    </div>
  );
}
