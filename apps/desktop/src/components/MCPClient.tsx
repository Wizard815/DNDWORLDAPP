import { useState, useEffect } from "react";

interface MCPConfig {
  dndworldappUrl: string;
  dndworldappToken: string;
  worldId: string;
}

interface MCPClientProps {
  config: MCPConfig;
  onEvent?: (event: string, data: unknown) => void;
}

/**
 * MCP Client wrapper for desktop app.
 * In v2, this would connect to actual MCP servers (dnd-oracle, etc.)
 * For now, provides a structured event system.
 */
export function MCPClient({ config, onEvent }: MCPClientProps) {
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [lastEvent, setLastEvent] = useState<string>("");

  useEffect(() => {
    // Simulate MCP connection
    const timeout = setTimeout(() => {
      setStatus("connected");
      setLastEvent("mcp:initialized");
      onEvent?.("mcp:initialized", {
        dndworldappUrl: config.dndworldappUrl,
        worldId: config.worldId,
      });
    }, 1000);

    return () => clearTimeout(timeout);
  }, [config, onEvent]);

  return (
    <div className="p-4 border-t border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-300">MCP Client</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status === "connected" ? "bg-green-500" :
            status === "connecting" ? "bg-yellow-500" :
            "bg-red-500"
          }`} />
          <span className="text-xs text-gray-400 capitalize">{status}</span>
        </div>
      </div>
      <div className="text-xs text-gray-500">
        <p>World: {config.worldId.slice(0, 8)}...</p>
        {lastEvent && <p className="mt-1">Last event: {lastEvent}</p>}
      </div>
    </div>
  );
}
