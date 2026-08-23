import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo, useRef, useState } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import type { FieldVisibility, MapMarkerDto, NodeDetail, NodeSummary } from "@dndworldapp/schema";
import { ApiError, api } from "../api.ts";
import { navigate } from "../lib/nav.ts";

const SHAPE_LABEL: Record<string, string> = {
  pin: "Pin",
  label: "Label",
  circle: "Circle",
};
const ADDABLE_SHAPES = ["pin", "label", "circle"] as const;

const VISIBILITY_LABEL: Record<FieldVisibility, string> = {
  public: "Public",
  members: "Players",
  dm: "DM only",
};

/**
 * `L.divIcon`'s `html` is set via `innerHTML` by Leaflet — a real raw-HTML sink, unlike
 * normal React children. Every user-controlled value interpolated into it (not just
 * label/icon text, but `color` too) must be escaped/validated, or a marker with edit
 * access can inject markup that runs in every other viewer's session, including the DM's.
 */
function safeColor(color: string | null, fallback: string): string {
  if (color !== null && /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z][a-zA-Z0-9]*$/.test(color)) return color;
  return fallback;
}

/** A pin/label rendered as a plain div icon — sidesteps Leaflet's default marker image assets entirely, which Vite doesn't bundle correctly out of the box. */
function iconFor(marker: MapMarkerDto): L.DivIcon {
  if (marker.shape === "label") {
    return L.divIcon({
      className: "",
      html: `<div style="white-space:nowrap;font-size:12px;font-weight:600;color:${safeColor(marker.color, "#d7d8dc")};text-shadow:0 1px 2px rgba(0,0,0,.8)">${escapeHtml(marker.label ?? "")}</div>`,
      iconSize: undefined,
      iconAnchor: [0, 0],
    });
  }
  const bg = safeColor(marker.color, "#3d5ab5");
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${bg};border:2px solid #17181b;box-shadow:0 1px 3px rgba(0,0,0,.5);font-size:15px;line-height:1">${escapeHtml(marker.icon ?? "📍")}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function DropHandler({ onDrop }: { onDrop: (x: number, y: number) => void }) {
  useMapEvents({
    click(e) {
      onDrop(e.latlng.lng, e.latlng.lat);
    },
  });
  return null;
}

export function MapView({ node, allNodes }: { node: NodeDetail; allNodes: NodeSummary[] }) {
  const queryClient = useQueryClient();
  const mapQuery = useQuery({
    queryKey: ["map", node.id],
    queryFn: async () => {
      try {
        return (await api.map(node.id)).map;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    // Tiling runs in the background server-side (no queue — see services/maps.ts's
    // startTiling); poll while it's in flight so the view upgrades from ImageOverlay
    // to TileLayer the moment it finishes, with no user action needed.
    refetchInterval: (query) =>
      query.state.data?.tilingStatus === "pending" || query.state.data?.tilingStatus === "running" ? 2000 : false,
  });
  const markersQuery = useQuery({
    queryKey: ["map-markers", node.id],
    queryFn: () => api.mapMarkers(node.id),
    enabled: mapQuery.data != null,
  });

  const [dropShape, setDropShape] = useState<(typeof ADDABLE_SHAPES)[number] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidateMap = () => queryClient.invalidateQueries({ queryKey: ["map", node.id] });
  const invalidateMarkers = () => queryClient.invalidateQueries({ queryKey: ["map-markers", node.id] });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const asset = await api.uploadAsset(node.worldId, file);
      return api.setMapImage(node.id, asset.id);
    },
    onSuccess: () => {
      setUploadError(null);
      invalidateMap();
    },
    onError: (err) => setUploadError(err instanceof ApiError ? err.message : "Could not upload that image."),
  });

  const create = useMutation({
    mutationFn: (input: { shape: (typeof ADDABLE_SHAPES)[number]; x: number; y: number }) =>
      api.createMarker(node.id, { ...input, visibility: "members" }),
    onSuccess: (result) => {
      invalidateMarkers();
      setDropShape(null);
      setSelectedId(result.marker.id);
    },
  });

  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof api.updateMarker>[1]) =>
      api.updateMarker(id, input),
    onSuccess: invalidateMarkers,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMarker(id),
    onSuccess: () => {
      invalidateMarkers();
      setSelectedId(null);
    },
  });

  const map = mapQuery.data;
  const markers = markersQuery.data?.markers ?? [];
  const selected = markers.find((m) => m.id === selectedId) ?? null;

  const bounds = useMemo<L.LatLngBoundsExpression | null>(
    () => (map !== null && map !== undefined ? [[0, 0], [map.height, map.width]] : null),
    [map],
  );

  if (mapQuery.isLoading) {
    return <div className="h-full p-8 text-sm text-[#7a7d86]">Loading…</div>;
  }

  if (map === null || map === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-[#7a7d86]">No map image set yet.</p>
        {node.canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined) void upload.mutate(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
              className="rounded-md bg-[#3d5ab5] px-3 py-1.5 text-sm text-white hover:bg-[#4867cc] disabled:opacity-50"
            >
              {upload.isPending ? "Uploading…" : "Upload map image"}
            </button>
            {uploadError !== null && <p className="text-xs text-[#e0888a]">{uploadError}</p>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {node.canEdit && (
        <div className="absolute right-3 top-3 z-[1000] flex gap-1 rounded-md border border-[#33363d] bg-[#1d1f23]/95 p-1 shadow-lg">
          {ADDABLE_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              onClick={() => setDropShape(dropShape === shape ? null : shape)}
              className={`rounded px-2 py-1 text-xs ${
                dropShape === shape ? "bg-[#3d5ab5] text-white" : "text-[#b6b8bf] hover:bg-[#26282e]"
              }`}
            >
              + {SHAPE_LABEL[shape]}
            </button>
          ))}
        </div>
      )}

      <MapContainer
        key={node.id}
        crs={L.CRS.Simple}
        bounds={bounds!}
        maxBounds={bounds!}
        minZoom={map.minZoom}
        maxZoom={map.tilingStatus === "ready" ? map.maxZoom : map.maxZoom + 2}
        className="h-full w-full bg-[#0e0f11]"
      >
        {map.tilingStatus === "ready" ? (
          <TileLayer
            key={map.assetUrl}
            url={`/tiles/${node.id}/{z}/{x}/{y}.webp`}
            minZoom={map.minZoom}
            maxZoom={map.maxZoom}
            tileSize={256}
            noWrap
          />
        ) : (
          <ImageOverlay url={map.assetUrl} bounds={bounds!} />
        )}
        {(map.tilingStatus === "pending" || map.tilingStatus === "running") && (
          <div className="absolute left-3 top-3 z-[1000] rounded-md border border-[#33363d] bg-[#1d1f23]/95 px-2.5 py-1.5 text-xs text-[#8d9099]">
            Tiling this map for smoother zoom…
          </div>
        )}
        {dropShape !== null && (
          <DropHandler
            onDrop={(x, y) => {
              create.mutate({ shape: dropShape, x, y });
            }}
          />
        )}
        {markers.map((marker) =>
          marker.shape === "circle" ? (
            <CircleMarker
              key={marker.id}
              center={[marker.y, marker.x]}
              radius={10}
              pathOptions={{ color: marker.color ?? "#3d5ab5", fillOpacity: 0.4 }}
              eventHandlers={{ click: () => setSelectedId(marker.id) }}
            />
          ) : (
            <Marker
              key={marker.id}
              position={[marker.y, marker.x]}
              icon={iconFor(marker)}
              draggable={node.canEdit}
              eventHandlers={{
                click: () => setSelectedId(marker.id),
                dragend: (e) => {
                  const pos = e.target.getLatLng();
                  update.mutate({ id: marker.id, x: pos.lng, y: pos.lat });
                },
              }}
            />
          ),
        )}
      </MapContainer>

      {selected !== null && (
        <MarkerInspector
          marker={selected}
          allNodes={allNodes}
          canEdit={node.canEdit}
          onClose={() => setSelectedId(null)}
          onSave={(input) => update.mutate({ id: selected.id, ...input })}
          onDelete={() => remove.mutate(selected.id)}
        />
      )}
    </div>
  );
}

function MarkerInspector({
  marker,
  allNodes,
  canEdit,
  onClose,
  onSave,
  onDelete,
}: {
  marker: MapMarkerDto;
  allNodes: NodeSummary[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof api.updateMarker>[1]) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(marker.label ?? "");
  const [icon, setIcon] = useState(marker.icon ?? "");
  const [color, setColor] = useState(marker.color ?? "");

  return (
    <div className="absolute bottom-3 right-3 z-[1000] w-72 rounded-md border border-[#33363d] bg-[#1d1f23] p-4 shadow-2xl">
      <div className="mb-2 flex items-center">
        <h3 className="text-sm font-semibold text-[#f0f1f4]">{SHAPE_LABEL[marker.shape] ?? marker.shape}</h3>
        <button type="button" onClick={onClose} className="ml-auto text-xs text-[#7a7d86] hover:text-[#d7d8dc]">
          Close
        </button>
      </div>

      {marker.targetNode !== null && (
        <button
          type="button"
          onClick={() => navigate(`/n/${marker.targetNode!.id}`)}
          className="mb-2 flex w-full items-center gap-1 rounded bg-[#232529] px-2 py-1.5 text-left text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
        >
          {marker.targetNode.icon ?? "📄"} Open {marker.targetNode.title} →
        </button>
      )}

      {canEdit ? (
        <div className="space-y-2">
          <label className="block text-[10px] uppercase tracking-wide text-[#7a7d86]">
            Link to a page
            <select
              value={marker.targetNode?.id ?? ""}
              onChange={(e) => onSave({ targetNodeId: e.target.value.length > 0 ? e.target.value : null })}
              className="mt-1 w-full rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-xs text-[#d7d8dc]"
            >
              <option value="">— none —</option>
              {allNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[10px] uppercase tracking-wide text-[#7a7d86]">
            Label override
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => onSave({ label: label.length > 0 ? label : null })}
              placeholder={marker.targetNode?.title ?? ""}
              className="mt-1 w-full rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-xs text-[#d7d8dc] outline-none focus:border-[#4a4d55]"
            />
          </label>

          {marker.shape !== "label" && (
            <label className="block text-[10px] uppercase tracking-wide text-[#7a7d86]">
              Icon override
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                onBlur={() => onSave({ icon: icon.length > 0 ? icon : null })}
                placeholder={marker.targetNode?.icon ?? "📍"}
                className="mt-1 w-full rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-xs text-[#d7d8dc] outline-none focus:border-[#4a4d55]"
              />
            </label>
          )}

          <label className="block text-[10px] uppercase tracking-wide text-[#7a7d86]">
            Color
            <input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              onBlur={() => onSave({ color: color.length > 0 ? color : null })}
              placeholder="#3d5ab5"
              className="mt-1 w-full rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-xs text-[#d7d8dc] outline-none focus:border-[#4a4d55]"
            />
          </label>

          <label className="block text-[10px] uppercase tracking-wide text-[#7a7d86]">
            Visibility
            <select
              value={marker.visibility}
              onChange={(e) => onSave({ visibility: e.target.value as FieldVisibility })}
              className="mt-1 w-full rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-xs text-[#d7d8dc]"
            >
              {(Object.keys(VISIBILITY_LABEL) as FieldVisibility[]).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={onDelete}
            className="w-full rounded border border-[#33363d] px-2 py-1 text-xs text-[#c98b8b] hover:bg-[#26282e]"
          >
            Delete marker
          </button>
        </div>
      ) : (
        <p className="text-xs text-[#8d9099]">{marker.label ?? "(untitled)"}</p>
      )}
    </div>
  );
}
