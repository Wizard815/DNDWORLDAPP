import { useQuery } from "@tanstack/react-query";
import type { NodeKind } from "@dndworldapp/schema";
import { api } from "../api.ts";

interface Tile {
  kind: NodeKind | null;
  icon: string;
  label: string;
  hint: string;
  soon?: boolean;
}

const TILES: Tile[] = [
  { kind: null, icon: "📄", label: "Lore", hint: "A page you write" },
  { kind: "map", icon: "🗺️", label: "Map", hint: "An interactive map" },
  { kind: "board", icon: "🗂️", label: "Board", hint: "Soon", soon: true },
  { kind: "timeline", icon: "🕰️", label: "Timeline", hint: "Soon", soon: true },
];

/**
 * The "+ New" chooser — replaces separate "+ New page"/"+ New map" buttons with one
 * entry point, matching the tile-picker pattern from reference apps (LegendKeeper):
 * blank kinds up front, plus a shortcut into any of the world's saved templates.
 * Board/Timeline are shown, not hidden, so the eventual shape is visible — same
 * philosophy as the MCP server's declared-but-not-built placeholder tools.
 */
export function CreateChooser({
  worldId,
  onClose,
  onCreate,
}: {
  worldId: string;
  onClose: () => void;
  onCreate: (input: { kind?: NodeKind; templateId?: string }) => void;
}) {
  const { data } = useQuery({ queryKey: ["templates", worldId], queryFn: () => api.templates(worldId) });
  const templates = data?.templates ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh]" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border border-[#33363d] bg-[#1d1f23] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center">
          <h2 className="text-base font-semibold text-[#f0f1f4]">New page</h2>
          <button type="button" onClick={onClose} className="ml-auto text-sm text-[#7a7d86] hover:text-[#d7d8dc]">
            Close
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {TILES.map((tile) => (
            <button
              key={tile.label}
              type="button"
              disabled={tile.soon}
              onClick={() => onCreate({ kind: tile.kind ?? undefined })}
              className="flex flex-col items-center gap-1.5 rounded-md border border-[#2c2f36] px-2 py-4 text-center hover:border-[#4a4d55] hover:bg-[#232529] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#2c2f36] disabled:hover:bg-transparent"
            >
              <span className="text-2xl">{tile.icon}</span>
              <span className="text-xs font-medium text-[#d7d8dc]">{tile.label}</span>
              <span className="text-[10px] text-[#7a7d86]">{tile.hint}</span>
            </button>
          ))}
        </div>

        {templates.length > 0 && (
          <div className="mt-5 border-t border-[#2c2f36] pt-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">
              Or start from a template
            </h3>
            <ul className="space-y-1">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onCreate({ templateId: t.id })}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[#b6b8bf] hover:bg-[#232529]"
                  >
                    <span>{t.icon ?? "📋"}</span>
                    <span className="truncate">{t.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
