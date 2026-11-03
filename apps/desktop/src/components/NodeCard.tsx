import type { NodeSummary } from "@dndworldapp/schema";

export interface NodeCardProps {
  node: NodeSummary;
  onClick: () => void;
}

export function NodeCard({ node, onClick }: NodeCardProps) {
  const visibilityColor =
    node.visibility === "dm" ? "border-yellow-500" :
    node.visibility === "private" ? "border-red-500" :
    node.visibility === "members" ? "border-blue-500" :
    "border-gray-500";

  const kindColor =
    node.kind === "map" ? "🗺️" :
    node.kind === "document" ? "📄" :
    "📝";

  return (
    <div
      className={`bg-gray-800 border-l-4 ${visibilityColor} rounded-r p-3 hover:bg-gray-750 cursor-pointer transition-colors`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{kindColor}</span>
        <span className="text-xs uppercase text-gray-500 w-14">{node.kind}</span>
        <span className="font-medium text-white truncate">{node.title}</span>
      </div>
      {/* No bodyMd on summary — it's only on NodeDetail */}
    </div>
  );
}
