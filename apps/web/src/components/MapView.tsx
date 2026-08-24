import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, ImageOverlay, MapContainer, Marker, Polygon, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { FieldVisibility, MapMarkerDto, MarkerPoint, NodeDetail, NodeSummary } from "@dndworldapp/schema";
import { formatMarkerPoints, parseMarkerPoints } from "@dndworldapp/schema";
import { ApiError, api } from "../api.ts";
import { navigate } from "../lib/nav.ts";

/**
 * `L.CRS.Simple`'s default transformation is `(1, 0, -1, 0)` — it negates y, because it
 * was designed for a math-style y-up grid. This app stores pixel space y-down (row 0 at
 * the top, matching Kanka/LegendKeeper — see docs/HANDOFF.md §7.8), so the negation would
 * put the whole image below row 0 into *negative* internal point-space. `ImageOverlay`
 * doesn't notice — it just stretches the image over the given bounds regardless of sign —
 * but `TileLayer`'s tile-index math does, and comes out with negative, nonexistent tile
 * rows for anything below the top edge (visible in the browser as a wall of 404s and a
 * blank map). A transformation of `(1, 0, 1, 0)` keeps y unmodified, so pixel space and
 * Leaflet's internal point space agree and tile indices land where sharp's tiler put them.
 */
const PIXEL_CRS = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(1, 0, 1, 0) });

/**
 * Beyond the sign, `CRS.Simple`'s `scale(zoom) = 2^zoom` means a LatLng only equals
 * its raw pixel value at ONE reference zoom — for a tiled map that's the deepest zoom
 * (the level sharp's tiler treats as native resolution: 2^maxZoom, so the "point" at
 * that zoom lands exactly on the pixel it was generated from), and for an untiled map
 * (plain ImageOverlay, no TileLayer to match) reference zoom 0 works fine since
 * nothing else demands a specific resolution level. Every marker/bounds coordinate
 * must be divided by this scale going into Leaflet (pixel → latlng) and multiplied by
 * it coming back out of an event (latlng → pixel) — otherwise TileLayer computes tile
 * indices for entirely the wrong resolution level (the "wall of 404s, blank map" bug).
 */
function scaleFor(map: { tilingStatus: string; maxZoom: number }): number {
  return map.tilingStatus === "ready" ? Math.pow(2, map.maxZoom) : 1;
}
function pixelToLatLng(x: number, y: number, scale: number): [number, number] {
  return [y / scale, x / scale];
}
function latLngToPixel(lat: number, lng: number, scale: number): { x: number; y: number } {
  return { x: lng * scale, y: lat * scale };
}

const SHAPE_LABEL: Record<string, string> = {
  pin: "Pin",
  label: "Label",
  circle: "Circle",
  polygon: "Region",
  path: "Path",
};
/** Click-once shapes. Polygon/path use the draw mode instead (see startDraft). */
const ADDABLE_SHAPES = ["pin", "label", "circle", "polygon", "path"] as const;
type AddableShape = (typeof ADDABLE_SHAPES)[number];
const DRAW_SHAPES = ["polygon", "path"] as const;
type DrawShape = (typeof DRAW_SHAPES)[number];

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

function DropHandler({ onDrop, scale }: { onDrop: (x: number, y: number) => void; scale: number }) {
  useMapEvents({
    click(e) {
      const p = latLngToPixel(e.latlng.lat, e.latlng.lng, scale);
      onDrop(p.x, p.y);
    },
  });
  return null;
}

/**
 * P4.3 draw mode: a click adds a vertex, a double-click (or the Done button)
 * finishes the shape, Escape cancels it. The map's pan/zoom stay live
 * (Kanka-style free drawing) — only clicks are captured, and only while a draft
 * is in progress. A double-click fires two clicks first, so the vertex list is
 * owned here: the two phantom clicks that accompany a dblclick land at (nearly)
 * the same spot and are stripped before the shape is committed.
 */
function DrawHandler({
  onVertex,
  onFinish,
  scale,
}: {
  onVertex: (points: MarkerPoint[]) => void;
  onFinish: (points: MarkerPoint[]) => void;
  scale: number;
}) {
  const map = useMap();
  const ptsRef = useRef<MarkerPoint[]>([]);
  const onVertexRef = useRef(onVertex);
  const onFinishRef = useRef(onFinish);
  onVertexRef.current = onVertex;
  onFinishRef.current = onFinish;
  useEffect(() => {
    map.doubleClickZoom.disable();
    return () => {
      map.doubleClickZoom.enable();
    };
  }, [map]);
  useMapEvents({
    click(e) {
      const p = latLngToPixel(e.latlng.lat, e.latlng.lng, scale);
      ptsRef.current = [...ptsRef.current, [p.x, p.y] as MarkerPoint];
      onVertexRef.current(ptsRef.current);
    },
    dblclick() {
      let pts = ptsRef.current;
      if (pts.length >= 3) {
        const a = pts[pts.length - 2]!;
        const b = pts[pts.length - 1]!;
        if (Math.abs(a[0] - b[0]) < 2 && Math.abs(a[1] - b[1]) < 2) pts = pts.slice(0, -2);
      }
      onFinishRef.current(pts);
    },
  });
  return null;
}

/** The draft's own Escape-to-cancel, scoped to this map's container. */
function DraftKeyHandler({ onCancel }: { onCancel: () => void }) {
  const map = useMap();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const el = map.getContainer();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [map]);
  return null;
}

/** The in-progress draft, rendered as it grows: the closed/open shape plus one marker per vertex. */
function DraftPreview({ shape, points, scale }: { shape: DrawShape; points: MarkerPoint[]; scale: number }) {
  const latlngs = polygonToLatLngs(points, scale);
  if (latlngs.length === 0) return null;
  const isPolygon = shape === "polygon";
  const shapeEl = isPolygon ? (
    <Polygon
      positions={latlngs}
      pathOptions={{ color: "#8b6cf0", weight: 2, dashArray: "6 4", fillOpacity: 0.1, interactive: false }}
    />
  ) : (
    <Polyline positions={latlngs} pathOptions={{ color: "#8b6cf0", weight: 2, dashArray: "6 4", interactive: false }} />
  );
  return (
    <>
      {shapeEl}
      {points.map(([x, y], i) => (
        <CircleMarker
          key={i}
          center={pixelToLatLng(x, y, scale)}
          radius={3}
          pathOptions={{ color: "#8b6cf0", weight: 2, fillColor: "#1d1f23", fillOpacity: 1, interactive: false }}
        />
      ))}
    </>
  );
}

/**
 * A stored polygon/path marker: the shape itself (clickable to open the
 * inspector) plus a label at its anchor. The anchor is the marker's own x/y
 * unless that sits exactly on a vertex, in which case the label would be
 * ambiguous and the centroid is used instead (see `anchorFor`).
 */
function PolygonShapeMarker({
  marker,
  canEdit,
  scale,
  onSelect,
  onMoveAnchor,
}: {
  marker: MapMarkerDto;
  canEdit: boolean;
  scale: number;
  onSelect: () => void;
  onMoveAnchor?: (x: number, y: number) => void;
}) {
  const points = parseMarkerPoints(marker.points);
  if (points === null || points.length === 0) {
    // Legacy/invalid data — still selectable so it can be fixed or deleted.
    return (
      <Marker
        position={pixelToLatLng(marker.x, marker.y, scale)}
        icon={L.divIcon({ className: "", html: `<div style="width:20px;height:20px;border-radius:9999px;background:#c98b8b;border:2px solid #17181b;display:flex;align-items:center;justify-content:center;font-size:11px">!</div>`, iconSize: [20, 20], iconAnchor: [10, 10] })}
        eventHandlers={{ click: onSelect }}
      />
    );
  }
  const color = safeColor(marker.color, "#8b6cf0");
  const latlngs = polygonToLatLngs(points, scale);
  const anchor = anchorFor(marker);
  const label = marker.label ?? (marker.targetNode !== null ? marker.targetNode.title : null);
  const pathEl =
    marker.shape === "polygon" ? (
      <Polygon
        positions={latlngs}
        pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.12, interactive: canEdit }}
        eventHandlers={canEdit ? { click: onSelect } : undefined}
      />
    ) : (
      <Polyline
        positions={latlngs}
        pathOptions={{ color, weight: 3, interactive: canEdit }}
        eventHandlers={canEdit ? { click: onSelect } : undefined}
      />
    );
  return (
    <>
      {pathEl}
      {anchor !== null && label !== null && (
        <Marker
          position={pixelToLatLng(anchor.x, anchor.y, scale)}
          icon={L.divIcon({ className: "", html: `<div style="white-space:nowrap;font-size:12px;font-weight:600;color:${color};text-shadow:0 1px 2px rgba(0,0,0,.8)">${escapeHtml(label)}</div>`, iconSize: undefined, iconAnchor: [0, 0] })}
          draggable={canEdit && onMoveAnchor !== undefined}
          eventHandlers={
            canEdit
              ? {
                  click: onSelect,
                  dragend: onMoveAnchor === undefined ? undefined : (e) => {
                    const pos = e.target.getLatLng();
                    const p = latLngToPixel(pos.lat, pos.lng, scale);
                    onMoveAnchor(p.x, p.y);
                  },
                }
              : undefined
          }
        />
      )}
    </>
  );
}

/** Stored "x,y x,y ..." (pixel space) → Leaflet latlngs, scaled for the current map (see `scaleFor`). */
function polygonToLatLngs(points: MarkerPoint[], scale: number): [number, number][] {
  return points.map(([x, y]) => pixelToLatLng(x, y, scale));
}

/** Average of the vertices — a fine default label position for a region, and the anchor a new draft starts from. */
function centroidOf(points: MarkerPoint[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Where a polygon/path's label sits: its explicit anchor (marker.x/y) when the
 * anchor is NOT exactly on a stored vertex, otherwise the centroid — the marker's
 * x/y is required to be non-null and is the natural spot for the anchor. A fresh
 * draft is anchored at its first click; "Reposition label" in the inspector sets
 * an explicit anchor afterwards.
 */
function anchorFor(marker: MapMarkerDto): { x: number; y: number } | null {
  const points = parseMarkerPoints(marker.points);
  if (points === null) return null;
  const onVertex = points.some(([x, y]) => x === marker.x && y === marker.y);
  return onVertex ? centroidOf(points) : { x: marker.x, y: marker.y };
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

  const [dropShape, setDropShape] = useState<AddableShape | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ shape: DrawShape; points: MarkerPoint[]; anchor: { x: number; y: number } | null; replaceId: string | null } | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
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
    mutationFn: (input: { shape: AddableShape; x: number; y: number }) =>
      api.createMarker(node.id, { ...input, visibility: "members" }),
    onSuccess: (result) => {
      invalidateMarkers();
      setDropShape(null);
      setSelectedId(result.marker.id);
    },
  });

  const createDraft = useMutation({
    mutationFn: (d: { shape: DrawShape; points: MarkerPoint[]; anchor: { x: number; y: number }; replaceId: string | null }) =>
      d.replaceId !== null
        ? api.updateMarker(d.replaceId, {
            points: formatMarkerPoints(d.points),
            x: d.anchor.x,
            y: d.anchor.y,
          })
        : api.createMarker(node.id, {
            shape: d.shape,
            x: d.anchor.x,
            y: d.anchor.y,
            points: formatMarkerPoints(d.points),
            visibility: "members",
          }),
    onSuccess: (result) => {
      setDraft(null);
      setDraftError(null);
      invalidateMarkers();
      setSelectedId(result.marker.id);
    },
    onError: (err) => setDraftError(err instanceof ApiError ? err.message : "Could not save that shape."),
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

  const startDraft = (shape: DrawShape, replaceId: string | null = null) => {
    setDropShape(null);
    setDraftError(null);
    setDraft({ shape, points: [], anchor: null, replaceId });
  };
  const cancelDraft = () => {
    setDraft(null);
    setDraftError(null);
  };
  const onDraftVertex = (points: MarkerPoint[]) => {
    setDraftError(null);
    setDraft((d) => {
      if (d === null) return d;
      const first = points[0] ?? ([d.anchor?.x ?? 0, d.anchor?.y ?? 0] as MarkerPoint);
      return { ...d, anchor: d.anchor ?? { x: first[0], y: first[1] }, points };
    });
  };
  const finishDraft = (points: MarkerPoint[]) => {
    if (draft === null) return;
    const min = draft.shape === "polygon" ? 3 : 2;
    if (points.length < min) {
      setDraftError(draft.shape === "polygon" ? "A region needs at least 3 points." : "A path needs at least 2 points.");
      return;
    }
    const first = points[0]!;
    const anchor = draft.anchor ?? { x: first[0], y: first[1] };
    createDraft.mutate({ shape: draft.shape, points, anchor, replaceId: draft.replaceId });
  };

  const scale = map !== null && map !== undefined ? scaleFor(map) : 1;
  const bounds = useMemo<L.LatLngBoundsExpression | null>(
    () => (map !== null && map !== undefined ? [[0, 0], [map.height / scale, map.width / scale]] : null),
    [map, scale],
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
      )}
      {node.canEdit && (
        <div className="absolute right-3 top-3 z-[1000] flex gap-1 rounded-md border border-[#33363d] bg-[#1d1f23]/95 p-1 shadow-lg">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
            title="Replace this map's source image"
            className="rounded px-2 py-1 text-xs text-[#b6b8bf] hover:bg-[#26282e] disabled:opacity-50"
          >
            {upload.isPending ? "Uploading…" : "🖼 Replace image"}
          </button>
          <div className="mx-0.5 w-px self-stretch bg-[#33363d]" />
          {ADDABLE_SHAPES.map((shape) =>
            (DRAW_SHAPES as readonly string[]).includes(shape) ? (
              <button
                key={shape}
                type="button"
                onClick={() => startDraft(shape as DrawShape)}
                className={`rounded px-2 py-1 text-xs ${
                  draft?.shape === shape ? "bg-[#8b6cf0] text-white" : "text-[#b6b8bf] hover:bg-[#26282e]"
                }`}
              >
                ✏ {SHAPE_LABEL[shape]}
              </button>
            ) : (
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
            ),
          )}
          {draft !== null && (
            <>
              <button
                type="button"
                onClick={() => finishDraft(draft.points)}
                className="rounded bg-[#3f7d4e] px-2 py-1 text-xs text-white hover:bg-[#4a9160]"
              >
                Done
              </button>
              <button
                type="button"
                onClick={cancelDraft}
                className="rounded px-2 py-1 text-xs text-[#c98b8b] hover:bg-[#26282e]"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {uploadError !== null && (
        <div className="absolute right-3 top-14 z-[1000] max-w-xs rounded-md border border-[#33363d] bg-[#1d1f23]/95 px-2.5 py-1.5 text-xs text-[#e0888a] shadow-lg">
          {uploadError}
        </div>
      )}

      <MapContainer
        key={node.id}
        crs={PIXEL_CRS}
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
            scale={scale}
            onDrop={(x, y) => {
              create.mutate({ shape: dropShape, x, y });
            }}
          />
        )}
        {draft !== null && (
          <>
            <DrawHandler onVertex={onDraftVertex} onFinish={finishDraft} scale={scale} />
            <DraftKeyHandler onCancel={cancelDraft} />
            <DraftPreview shape={draft.shape} points={draft.points} scale={scale} />
          </>
        )}
        {(dropShape !== null || draft !== null) && (
          <div className="absolute left-3 top-3 z-[1000] rounded-md border border-[#33363d] bg-[#1d1f23]/95 px-2.5 py-1.5 text-xs text-[#b6b8bf]">
            {draft !== null ? (
              <>
                Drawing a {SHAPE_LABEL[draft.shape]?.toLowerCase() ?? draft.shape} — click to add points, double-click
                or Done to finish, Esc to cancel.{" "}
                {draftError !== null && <span className="text-[#e0888a]">{draftError}</span>}
              </>
            ) : (
              <>Click to place a {SHAPE_LABEL[dropShape ?? ""]?.toLowerCase() ?? ""}, or pick another shape to change.</>
            )}
          </div>
        )}
        {markers.map((marker) =>
          draft !== null && draft.replaceId === marker.id ? null : marker.shape === "polygon" || marker.shape === "path" ? (
            <PolygonShapeMarker
              key={marker.id}
              marker={marker}
              canEdit={node.canEdit}
              scale={scale}
              onSelect={() => setSelectedId(marker.id)}
              onMoveAnchor={
                node.canEdit
                  ? (x, y) => update.mutate({ id: marker.id, x, y })
                  : undefined
              }
            />
          ) : marker.shape === "circle" ? (
            <CircleMarker
              key={marker.id}
              center={pixelToLatLng(marker.x, marker.y, scale)}
              radius={10}
              pathOptions={{ color: marker.color ?? "#3d5ab5", fillOpacity: 0.4 }}
              eventHandlers={{ click: () => setSelectedId(marker.id) }}
            />
          ) : (
            <Marker
              key={marker.id}
              position={pixelToLatLng(marker.x, marker.y, scale)}
              icon={iconFor(marker)}
              draggable={node.canEdit}
              eventHandlers={{
                click: () => setSelectedId(marker.id),
                dragend: (e) => {
                  const pos = e.target.getLatLng();
                  const p = latLngToPixel(pos.lat, pos.lng, scale);
                  update.mutate({ id: marker.id, x: p.x, y: p.y });
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
          onRedraw={
            node.canEdit && (selected.shape === "polygon" || selected.shape === "path")
              ? () => startDraft(selected.shape as DrawShape, selected.id)
              : undefined
          }
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
  onRedraw,
}: {
  marker: MapMarkerDto;
  allNodes: NodeSummary[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof api.updateMarker>[1]) => void;
  onDelete: () => void;
  onRedraw?: () => void;
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
          {(marker.shape === "polygon" || marker.shape === "path") && onRedraw !== undefined && (
            <button
              type="button"
              onClick={onRedraw}
              className="w-full rounded border border-[#4a4d55] bg-[#232529] px-2 py-1 text-xs text-[#b6b8bf] hover:bg-[#2b2e35]"
            >
              ✏ Redraw shape
            </button>
          )}
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

          {marker.shape !== "label" && marker.shape !== "polygon" && marker.shape !== "path" && (
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
