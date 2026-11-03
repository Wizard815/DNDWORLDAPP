import { useState, useEffect } from "react";
import type { NodeDetail } from "@dndworldapp/schema";
import { DndClient } from "@dndworldapp/dnd-client";

interface NodeDetailViewerProps {
  nodeId: string;
  client: DndClient;
  onBack: () => void;
}

export function NodeDetailViewer({ nodeId, client, onBack }: NodeDetailViewerProps) {
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadNode() {
      try {
        const { node } = await client.getNode(nodeId);
        setNode(node);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load node");
      } finally {
        setLoading(false);
      }
    }
    loadNode();
  }, [nodeId, client]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error || !node) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-400">
          <p>{error || "Node not found"}</p>
          <button onClick={onBack} className="mt-4 text-blue-400 hover:text-blue-300">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-white mb-4"
        >
          ← Back to tree
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">{node.title}</h1>
            <div className="flex items-center gap-3 text-sm text-gray-400">
              <span className="uppercase tracking-wide">{node.kind}</span>
              <span>•</span>
              <span>Visibility: {node.visibility}</span>
              <span>•</span>
              <span>Last updated: {new Date(node.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="px-2 py-1 bg-blue-900/50 text-blue-300 rounded text-xs">
              {node.kind}
            </span>
            <span className={`px-2 py-1 rounded text-xs ${
              node.visibility === 'dm' ? 'bg-yellow-900/50 text-yellow-300' :
              node.visibility === 'private' ? 'bg-red-900/50 text-red-300' :
              node.visibility === 'members' ? 'bg-blue-900/50 text-blue-300' :
              'bg-green-900/50 text-green-300'
            }`}>
              {node.visibility.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Tags */}
      {node.tags.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {node.tags.map((tag) => (
              <span
                key={tag.id}
                className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs cursor-pointer hover:bg-gray-600"
              >
                #{tag.title}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="prose prose-invert max-w-none">
        <div className="bg-gray-800 p-4 rounded-lg">
          {/* Render markdown content */}
          <div className="text-gray-300 whitespace-pre-wrap">
            {node.bodyMd}
          </div>
        </div>
      </div>

      {/* Backlinks */}
      {node.backlinks.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Backlinks</h3>
          <div className="space-y-1">
            {node.backlinks.map((link) => (
              <div key={link.nodeId} className="text-sm text-gray-400 hover:text-white cursor-pointer">
                • {link.title}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Children */}
      {node.children.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Children</h3>
          <div className="space-y-1">
            {node.children.map((child) => (
              <div key={child.id} className="text-sm text-gray-400 hover:text-white cursor-pointer">
                • {child.icon} {child.title} ({child.kind})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="mt-6 pt-4 border-t border-gray-700">
        <div className="text-xs text-gray-500">
          <p>Node ID: {nodeId}</p>
          <p>World: {node.worldId}</p>
          {node.templateId && <p>Template: {node.templateId}</p>}
          {node.canEdit && <p className="text-green-400">✓ Can edit</p>}
        </div>
      </div>
    </div>
  );
}
