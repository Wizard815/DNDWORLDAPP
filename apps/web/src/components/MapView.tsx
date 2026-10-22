import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, ImageOverlay, MapContainer, Marker, Polygon, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { FieldVisibility, MapDto, MapGroupDto, MapMarkerDto, MarkerPoint, MarkerPresetDto, NodeDetail, NodeSummary } from "@dndworldapp/schema";
import { formatMarkerPoints, mapTileUrlTemplate, parseMarkerPoints } from "@dndworldapp/schema";
import { ApiError, api } from "../api.ts";
import { latLngToPixel, pixelToLatLng } from "../lib/mapCoords.ts";
import { navigate } from "../lib/nav.ts";
import { Glyph, glyphHtml } from "./Glyph.tsx";
import { IconPicker } from "./IconPicker.tsx";
import { FogEditorLayer, FogPanel, type FogTool } from "./MapFog.tsx";
import { MeasureLayer, MeasurePanel, type MeasureMode } from "./MapMeasure.tsx";

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

/**
 * A circle marker's radius, stored in the same native-image pixel space as
 * x/y/points (migration 0009) so it represents a real amount of the map and
 * scales with zoom exactly like a region's vertices already do — not a
 * constant on-screen size, which is what `L.CircleMarker` gives you and is
 * why circles couldn't be resized meaningfully before this: there was no
 * stored size at all, just a hardcoded `radius={10}` screen pixels. This
 * default is a stand-in for markers created before this column existed.
 */
const DEFAULT_CIRCLE_RADIUS_PX = 80;
const MIN_CIRCLE_RADIUS_PX = 1;
const MAX_CIRCLE_RADIUS_PX = 500;

const SHAPE_LABEL: Record<string, string> = {
  pin: "Pin",
  label: "Label",
  circle: "Circle",
  polygon: "Region",
  path: "Path",
  token: "Token",
};
/** A token's default icon when it has none of its own and links to nothing — party/army marker, not a place. */
const DEFAULT_TOKEN_ICON = "🚩";
/** Click-once shapes. Polygon/path use the draw mode instead (see startDraft). */
const ADDABLE_SHAPES = ["pin", "label", "circle", "polygon", "path", "token"] as const;
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
  const fallbackIcon = marker.shape === "token" ? DEFAULT_TOKEN_ICON : "📍";
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${bg};border:2px solid #17181b;box-shadow:0 1px 3px rgba(0,0,0,.5);font-size:15px;line-height:1">${glyphHtml(marker.icon ?? fallbackIcon, escapeHtml, "#fff")}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** The part of a preset a new marker copies. Empty when there's no preset, so it can be spread unconditionally. */
function presetLook(preset: MarkerPresetDto | null): { icon?: string | null; color?: string | null; radius?: number | null } {
  if (preset === null) return {};
  return { icon: preset.icon, color: preset.color, radius: preset.shape === "circle" ? preset.radius : null };
}

/** A preset's look in miniature, for the presets menu. */
function PresetSwatch({ preset }: { preset: MarkerPresetDto }) {
  const background = safeColor(preset.color, "#3d5ab5");
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] text-white"
      style={{ background }}
    >
      {preset.shape === "pin" || preset.shape === "token" ? <Glyph icon={preset.icon ?? (preset.shape === "token" ? DEFAULT_TOKEN_ICON : "📍")} /> : null}
    </span>
  );
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
 * finishes the shape, Escape cancels it, Ctrl/Cmd+Z undoes the last vertex so
 * a mis-click doesn't mean starting over. The map's pan/zoom stay live
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
  useEffect(() => {
    const el = map.getContainer();
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (ptsRef.current.length === 0) return;
      ptsRef.current = ptsRef.current.slice(0, -1);
      onVertexRef.current(ptsRef.current);
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
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

/**
 * `<MapContainer>` (react-leaflet) only reads minZoom/maxZoom/maxBounds/
 * maxBoundsViscosity ONCE, at the instant the underlying `L.Map` is
 * constructed — its own source memoizes that construction with an empty
 * dependency array, so passing a new value as a prop later has no effect on
 * an already-mounted map. Since this map only remounts when navigating to a
 * *different* node (`key={node.id}` above), staying on the same map page
 * across a tiling completion, a code change, or anything else that recomputes
 * these values left the live map stuck on whatever it opened with — which is
 * exactly why raising the untiled zoom ceiling didn't do anything for a map
 * that was already open. This applies the current values imperatively
 * instead, via Leaflet's own setters, so they take effect immediately no
 * matter when they change.
 */
/** How often a player's map re-checks the fog while it's on. */
const FOG_POLL_MS = 4000;

/** Tolerance for comparing fractional zooms (zoomSnap is 0), so a marker set to exactly the current zoom doesn't flicker. */
const ZOOM_EPSILON = 0.01;

/** Reports Leaflet's zoom and its current min/max up to MapView whenever any of them change. */
function ZoomWatcher({ onChange }: { onChange: (state: { zoom: number; min: number; max: number }) => void }) {
  const map = useMap();
  const report = () => onChange({ zoom: map.getZoom(), min: map.getMinZoom(), max: map.getMaxZoom() });
  // moveend and zoomlevelschange too, not just zoomend: MapOptionsSync's
  // fit-to-container and min-zoom floor land after mount without a zoomend.
  useMapEvents({ zoomend: report, moveend: report, zoomlevelschange: report, load: report });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(report, [map]);
  return null;
}

function MapOptionsSync({
  minZoom,
  maxZoom,
  maxBounds,
  maxBoundsViscosity,
  fitBounds,
}: {
  minZoom: number;
  maxZoom: number;
  maxBounds: L.LatLngBounds;
  maxBoundsViscosity: number;
  fitBounds: L.LatLngBoundsLiteral;
}) {
  const map = useMap();
  useEffect(() => {
    map.setMaxZoom(maxZoom);
  }, [map, maxZoom]);
  useEffect(() => {
    map.setMaxBounds(maxBounds);
    // No setter exists for this one; Leaflet's own drag-constraint code just
    // reads the option straight off `map.options` every time it needs it.
    map.options.maxBoundsViscosity = maxBoundsViscosity;
  }, [map, maxBounds, maxBoundsViscosity]);

  /**
   * The stored `minZoom` (usually 0) is the coarsest *tile* the pyramid has —
   * a single 256×256 root tile, one per map regardless of its real shape.
   * For anything non-square, sharp still has to pad that lone tile out to a
   * square (tiles are always square), so zoom 0 always contains real,
   * baked-in padding pixels on one axis. That's not a fit/CSS problem —
   * it's actual tile content — so no amount of fitBounds/zoomSnap tuning
   * touches it. The fix is to never let the view reach a zoom that coarse in
   * the first place: raise the effective floor to whatever zoom exactly
   * fits the real image into the *current* container, so "zoomed all the
   * way out" always means "the whole image, no padding" instead of "the
   * padded root tile." Recomputed on every resize since the fit zoom is a
   * function of the container's current size.
   */
  useEffect(() => {
    function syncFloorAndFit(alsoFit: boolean): void {
      map.invalidateSize();
      const fitZoom = map.getBoundsZoom(fitBounds);
      map.setMinZoom(Math.max(minZoom, fitZoom));
      if (alsoFit) map.fitBounds(fitBounds);
    }
    // Same "only applied once, at construction" gotcha as the rest of this
    // component: MapContainer's own `bounds` prop calls fitBounds() exactly
    // once, against whatever the container measured at that instant — which
    // loses a race against the CSS `aspect-ratio` layout pass on its wrapper
    // (the container isn't shaped like the image yet when Leaflet first
    // measures it), leaving the initial view fit to a too-wide guess and the
    // real image letterboxed inside it. invalidateSize() first so Leaflet
    // re-measures the now-correctly-shaped container before refitting.
    syncFloorAndFit(true);

    // A later resize of the container alone — dragging the sidebar, not the
    // window — needs the same re-measurement so Leaflet's internal size
    // cache and the zoom floor don't go stale. trackResize only listens for
    // window resizes. Deliberately just re-floors, not a re-fit: refitting
    // on every sidebar drag would fight a DM's own pan/zoom mid-session.
    const container = map.getContainer();
    const observer = new ResizeObserver(() => syncFloorAndFit(false));
    observer.observe(container);
    return () => observer.disconnect();
    // fitBounds is itself memoized off the map's real width/height, so the
    // initial fit only re-fires on mount and when the image actually
    // changes (e.g. "Replace image") — not on every unrelated re-render.
  }, [map, minZoom, fitBounds]);
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

/** A small draggable dot marking one vertex of a shape being edited. */
function VertexHandle({
  point,
  scale,
  color,
  onDrag,
}: {
  point: MarkerPoint;
  scale: number;
  color: string;
  onDrag: (x: number, y: number) => void;
}) {
  return (
    <Marker
      position={pixelToLatLng(point[0], point[1], scale)}
      icon={L.divIcon({
        className: "",
        html: `<div style="width:12px;height:12px;border-radius:9999px;background:${color};border:2px solid #17181b;box-shadow:0 1px 3px rgba(0,0,0,.6);cursor:move"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      })}
      draggable
      eventHandlers={{
        dragend: (e) => {
          const pos = e.target.getLatLng();
          const p = latLngToPixel(pos.lat, pos.lng, scale);
          onDrag(p.x, p.y);
        },
      }}
    />
  );
}

/**
 * One editable segment between two consecutive vertices. Rendered as two
 * overlapping lines: a wide, near-invisible one purely to make the segment
 * easy to click (Leaflet's own hit-testing is otherwise pixel-thin), and a
 * bright dashed highlight on top so it's visually obvious which lines you're
 * clicking on right now (docs request: "highlight the lines when doing it").
 * A click inserts a new vertex at the clicked point, between this segment's
 * two endpoints — the split the user asked for.
 */
function SegmentHandle({
  a,
  b,
  scale,
  onSplit,
}: {
  a: MarkerPoint;
  b: MarkerPoint;
  scale: number;
  onSplit: (x: number, y: number) => void;
}) {
  const positions: [number, number][] = [pixelToLatLng(a[0], a[1], scale), pixelToLatLng(b[0], b[1], scale)];
  const onClick = (e: L.LeafletMouseEvent) => {
    L.DomEvent.stopPropagation(e);
    const p = latLngToPixel(e.latlng.lat, e.latlng.lng, scale);
    onSplit(p.x, p.y);
  };
  return (
    <>
      <Polyline
        positions={positions}
        pathOptions={{ color: "#fff", weight: 14, opacity: 0.01 }}
        eventHandlers={{ click: onClick }}
      />
      <Polyline
        positions={positions}
        pathOptions={{ color: "#fff", weight: 2, dashArray: "4 4", interactive: false }}
      />
    </>
  );
}

/**
 * A stored polygon/path marker: the shape itself (clickable to open the
 * inspector) plus a label at its anchor. The anchor is the marker's own x/y
 * unless that sits exactly on a vertex, in which case the label would be
 * ambiguous and the centroid is used instead (see `anchorFor`).
 *
 * While `isEditing` (this marker is the one currently selected), the shape
 * grows per-segment click-to-split handles and a draggable dot on every
 * vertex — editing an *existing* shape used to mean "redraw the whole thing
 * from scratch" (the inspector's "Redraw shape" button), with no way to
 * nudge one point or add a single vertex to an otherwise-correct region.
 */
function PolygonShapeMarker({
  marker,
  canEdit,
  isEditing,
  scale,
  onSelect,
  onMoveAnchor,
  onUpdatePoints,
}: {
  marker: MapMarkerDto;
  canEdit: boolean;
  isEditing: boolean;
  scale: number;
  onSelect: () => void;
  onMoveAnchor?: (x: number, y: number) => void;
  onUpdatePoints?: (points: MarkerPoint[]) => void;
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
  const editing = isEditing && canEdit && onUpdatePoints !== undefined;
  const pathEl =
    marker.shape === "polygon" ? (
      <Polygon
        positions={latlngs}
        pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.12, interactive: canEdit && !editing }}
        eventHandlers={canEdit && !editing ? { click: onSelect } : undefined}
      />
    ) : (
      <Polyline
        positions={latlngs}
        pathOptions={{ color, weight: 3, interactive: canEdit && !editing }}
        eventHandlers={canEdit && !editing ? { click: onSelect } : undefined}
      />
    );

  function updateVertex(index: number, x: number, y: number): void {
    const next = points!.map((p, i) => (i === index ? ([x, y] as MarkerPoint) : p));
    onUpdatePoints!(next);
  }
  function insertVertexAfter(index: number, x: number, y: number): void {
    const next = [...points!.slice(0, index + 1), [x, y] as MarkerPoint, ...points!.slice(index + 1)];
    onUpdatePoints!(next);
  }

  // Segments: consecutive pairs, plus a closing pair back to the first vertex
  // for a polygon (a path has no such wraparound — its ends are just ends).
  const segmentCount = marker.shape === "polygon" ? points.length : points.length - 1;

  return (
    <>
      {pathEl}
      {editing && (
        <>
          {Array.from({ length: segmentCount }, (_, i) => (
            <SegmentHandle
              key={i}
              a={points[i]!}
              b={points[(i + 1) % points.length]!}
              scale={scale}
              onSplit={(x, y) => insertVertexAfter(i, x, y)}
            />
          ))}
          {points.map((p, i) => (
            <VertexHandle key={i} point={p} scale={scale} color={color} onDrag={(x, y) => updateVertex(i, x, y)} />
          ))}
        </>
      )}
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

export function MapView({
  node,
  allNodes,
  isGameMaster,
}: {
  node: NodeDetail;
  allNodes: NodeSummary[];
  /** Marker presets are world configuration — only the owner/DM can save or delete one. */
  isGameMaster: boolean;
}) {
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
    // Also polled for a player while fog is on, so the DM's reveals show up
    // within a few seconds — there's no push channel yet (ROADMAP §5).
    refetchInterval: (query) =>
      query.state.data?.tilingStatus === "pending" || query.state.data?.tilingStatus === "running"
        ? 2000
        : query.state.data?.fogEnabled === true && !isGameMaster
          ? FOG_POLL_MS
          : false,
  });
  const markersQuery = useQuery({
    queryKey: ["map-markers", node.id, mapQuery.data?.fogVersion ?? null],
    queryFn: () => api.mapMarkers(node.id),
    enabled: mapQuery.data != null,
    placeholderData: (previous) => previous,
  });
  const groupsQuery = useQuery({
    queryKey: ["map-groups", node.id],
    queryFn: () => api.mapGroups(node.id),
    enabled: mapQuery.data != null,
  });
  const hiddenGroups = useHiddenMapGroups(node.id);
  const presetsQuery = useQuery({
    queryKey: ["marker-presets", node.worldId],
    queryFn: () => api.markerPresets(node.worldId),
    enabled: node.canEdit,
  });

  const [dropShape, setDropShape] = useState<AddableShape | null>(null);
  /**
   * The preset the next placed or drawn marker copies its look from. Copied,
   * not linked — see migration 0011 — so it only rides along until the marker
   * is created, and picking a plain shape button clears it.
   */
  const [activePreset, setActivePreset] = useState<MarkerPresetDto | null>(null);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  /** The measuring tool's route, in map pixel space. null = tool closed. Local only; see MapMeasure.tsx. */
  const [measurePoints, setMeasurePoints] = useState<MarkerPoint[] | null>(null);
  const [measureMode, setMeasureMode] = useState<MeasureMode>("points");
  // Owner/DM fog controls — see MapFog.tsx.
  const [fogPanelOpen, setFogPanelOpen] = useState(false);
  const [fogTool, setFogTool] = useState<FogTool>("reveal");
  const [fogBrushPx, setFogBrushPx] = useState(40);
  const [fogFill, setFogFill] = useState<{ seq: number; fill: "reveal" | "hide" } | null>(null);
  const [fogSaveState, setFogSaveState] = useState<string | null>(null);
  // "Groups" (visibility filter) and "Markers" (browse/jump-to) share one
  // bottom-left slot — they're both read-oriented side panels, not edit
  // tools, so showing both at once would just be two lists competing for
  // the same corner. Opening one closes the other.
  const [openPanel, setOpenPanel] = useState<"groups" | "markers" | null>(null);
  // Collapsed by default — "Groups" is a personal display toggle everyone
  // sees, but the shape-adder/Replace-image/Done-Cancel controls are DM
  // clutter on a map you're just looking at, not building. Forced open
  // (see the `|| draft !== null` checks below) while a draft is mid-draw so
  // its own Done/Cancel buttons stay reachable even if this gets collapsed.
  const [editToolbarOpen, setEditToolbarOpen] = useState(false);
  const mapInstanceRef = useRef<L.Map | null>(null);
  /** Leaflet's current zoom and allowed range, mirrored into React by ZoomWatcher so markers can filter on it. */
  const [zoomState, setZoomState] = useState<{ zoom: number; min: number; max: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ shape: DrawShape; points: MarkerPoint[]; anchor: { x: number; y: number } | null; replaceId: string | null } | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const invalidateMap = () => queryClient.invalidateQueries({ queryKey: ["map", node.id] });
  const invalidateMarkers = () => queryClient.invalidateQueries({ queryKey: ["map-markers", node.id] });
  const invalidateGroups = () => queryClient.invalidateQueries({ queryKey: ["map-groups", node.id] });

  const createGroup = useMutation({
    mutationFn: (input: { name: string; parentGroupId: string | null }) => api.createMapGroup(node.id, input),
    onSuccess: invalidateGroups,
  });
  const updateGroup = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof api.updateMapGroup>[1]) =>
      api.updateMapGroup(id, input),
    onSuccess: invalidateGroups,
  });
  const moveGroup = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof api.moveMapGroup>[1]) =>
      api.moveMapGroup(id, input),
    onSuccess: invalidateGroups,
  });
  const removeGroup = useMutation({
    mutationFn: (id: string) => api.deleteMapGroup(id),
    onSuccess: () => {
      invalidateGroups();
      invalidateMarkers(); // markers that were in the deleted group are now ungrouped
    },
  });

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
      api.createMarker(node.id, { ...input, ...presetLook(activePreset), visibility: "members" }),
    onSuccess: (result) => {
      invalidateMarkers();
      setDropShape(null);
      setActivePreset(null);
      setSelectedId(result.marker.id);
    },
  });

  const toggleFog = useMutation({
    mutationFn: (enabled: boolean) => api.updateMap(node.id, { fogEnabled: enabled }),
    onSuccess: invalidateMap,
  });

  const saveScale = useMutation({
    mutationFn: (scale: MapDto["scale"]) => api.updateMap(node.id, { scale }),
    onSuccess: invalidateMap,
  });

  const invalidatePresets = () => queryClient.invalidateQueries({ queryKey: ["marker-presets", node.worldId] });
  const savePreset = useMutation({
    mutationFn: (input: Parameters<typeof api.createMarkerPreset>[1]) => api.createMarkerPreset(node.worldId, input),
    onSuccess: invalidatePresets,
  });
  const removePreset = useMutation({
    mutationFn: (presetId: string) => api.deleteMarkerPreset(node.worldId, presetId),
    onSuccess: invalidatePresets,
  });

  function placeFromPreset(preset: MarkerPresetDto): void {
    setPresetMenuOpen(false);
    setMeasurePoints(null);
    if ((DRAW_SHAPES as readonly string[]).includes(preset.shape)) {
      startDraft(preset.shape as DrawShape);
    } else {
      setDraft(null);
      setDropShape(preset.shape as AddableShape);
    }
    setActivePreset(preset);
  }

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
            ...presetLook(activePreset),
            visibility: "members",
          }),
    onSuccess: (result) => {
      setDraft(null);
      setActivePreset(null);
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
  const groups = groupsQuery.data?.groups ?? [];
  const selected = markers.find((m) => m.id === selectedId) ?? null;

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  /** A group hidden locally hides its markers AND every marker in any group nested under it. */
  function isGroupEffectivelyHidden(groupId: string | null): boolean {
    let currentId = groupId;
    const visited = new Set<string>();
    while (currentId !== null) {
      if (hiddenGroups.hiddenIds.has(currentId)) return true;
      if (visited.has(currentId)) break;
      visited.add(currentId);
      currentId = groupsById.get(currentId)?.parentGroupId ?? null;
    }
    return false;
  }
  /**
   * What actually gets drawn: hidden-group markers dropped, the rest ordered
   * by their group's sort_key — a later sort_key paints on top, which is the
   * "height order" a group's position in the panel controls. Ungrouped
   * markers paint last (always on top), since they're usually one-off,
   * player-placed pins that should stay clickable rather than sit under a
   * decorative region. `markers` itself (unfiltered) still backs the
   * inspector and the "Group" dropdowns, so toggling a group off doesn't make
   * an already-selected marker in it impossible to re-show or re-group.
   */
  const visibleMarkers = useMemo(() => {
    return markers
      .filter((m) => !isGroupEffectivelyHidden(m.groupId))
      .slice()
      .sort((a, b) => {
        const ra = a.groupId !== null ? (groupsById.get(a.groupId)?.sortKey ?? null) : null;
        const rb = b.groupId !== null ? (groupsById.get(b.groupId)?.sortKey ?? null) : null;
        if (ra === null && rb === null) return 0;
        if (ra === null) return 1;
        if (rb === null) return -1;
        return ra < rb ? -1 : ra > rb ? 1 : 0;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, groupsById, hiddenGroups.hiddenIds]);

  const startDraft = (shape: DrawShape, replaceId: string | null = null) => {
    setMeasurePoints(null);
    setFogPanelOpen(false);
    setDropShape(null);
    setDraftError(null);
    setDraft({ shape, points: [], anchor: null, replaceId });
  };
  const cancelDraft = () => {
    setDraft(null);
    setDraftError(null);
    setActivePreset(null);
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
  /**
   * Zoom as magnification relative to the image's own pixels (0 = 100%) —
   * the map-independent unit markers store their zoom range in (migration
   * 0012). Leaflet's raw zoom is offset by log2(scale) on a tiled map.
   */
  const nativeZoom = Math.log2(scale);
  const magnification =
    zoomState !== null
      ? { current: zoomState.zoom - nativeZoom, min: zoomState.min - nativeZoom, max: zoomState.max - nativeZoom }
      : null;
  /**
   * Out-of-range markers drop out — except while the edit toolbar is open,
   * where a DM needs to reach everything, and for the selected marker, so
   * zooming out doesn't yank the inspector's subject off the map.
   */
  const drawnMarkers =
    magnification === null || (node.canEdit && editToolbarOpen)
      ? visibleMarkers
      : visibleMarkers.filter(
          (m) =>
            m.id === selectedId ||
            ((m.minZoom === null || magnification.current >= m.minZoom - ZOOM_EPSILON) &&
              (m.maxZoom === null || magnification.current <= m.maxZoom + ZOOM_EPSILON)),
        );
  const bounds = useMemo<L.LatLngBoundsLiteral | null>(
    () => (map !== null && map !== undefined ? [[0, 0], [map.height / scale, map.width / scale]] : null),
    [map, scale],
  );
  /**
   * `maxBounds` was set to the image's exact edges, so panning to look at a
   * corner shoved it to the very edge of the viewport with nowhere left to
   * go — the empty space beyond the image (necessarily there whenever the
   * viewport's aspect ratio doesn't exactly match the image's) then had
   * nothing else to show but bare map-container background, which read as a
   * stray "black bar." Padding `maxBounds` by half a screen's worth on every
   * side gives room to center a corner or edge in the middle of the view —
   * `bounds` (the initial fit-to-content view) stays exact so the map still
   * opens showing the whole image.
   */
  const panBounds = useMemo<L.LatLngBounds | null>(
    () => (bounds !== null ? L.latLngBounds(bounds).pad(0.5) : null),
    [bounds],
  );

  if (mapQuery.isLoading) {
    return <div className="h-64 p-8 text-sm text-fg-muted">Loading…</div>;
  }

  if (map === null || map === undefined) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-fg-muted">No map image set yet.</p>
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
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {upload.isPending ? "Uploading…" : "Upload map image"}
            </button>
            {uploadError !== null && <p className="text-xs text-danger">{uploadError}</p>}
          </>
        )}
      </div>
    );
  }

  const computedMaxZoom = map.tilingStatus === "ready" ? map.maxZoom : map.maxZoom + 6;
  /**
   * The stored min_zoom (0) only means something for a tiled map, where it's
   * the padded root tile MapOptionsSync must keep the view away from. An
   * untiled map is one ImageOverlay with no root tile, and at its reference
   * zoom 0 is 100% — so flooring it at 0 meant any untiled map wider or taller
   * than its panel could never be zoomed out to show the whole image. Let it
   * go as low as needed; MapOptionsSync still floors it at the fit-to-panel
   * zoom, so "all the way out" is exactly the whole image.
   */
  const effectiveMinZoom = map.tilingStatus === "ready" ? map.minZoom : -8;

  return (
    <div
      className="relative w-full"
      // The container's shape matches the image's aspect ratio (width stays
      // the definite dimension, height follows from it) — that's what fixed
      // the original "black bar" bug, where a fixed height independent of
      // the image's real shape left Leaflet's fitBounds centering the image
      // with a gap on one axis that read as a stray dark bar.
      //
      // maxHeight caps that computed height for tall/portrait images so the
      // toolbar and MarkerInspector — both anchored to this box's own
      // top/bottom corners — stay reachable without scrolling on a full-
      // screen browser (reported directly: both required a scrollbar to
      // reach). This DOES reintroduce a width/height mismatch for anything
      // portrait enough to hit the cap, which sounds like the same bug —
      // but it isn't anymore: what actually made a mismatched box look
      // broken was two independent zoom bugs (default zoomSnap=1, and the
      // uncapped zoom-out floor exposing zoom-0's mandatory square root
      // tile), both fixed elsewhere in this file (zoomSnap={0} below, and
      // MapOptionsSync's getBoundsZoom-based minZoom floor). With those
      // fixed, a mismatched box just pillarboxes cleanly like any
      // object-fit:contain viewer — no bug, just expected letterboxing.
      style={{ aspectRatio: `${map.width} / ${map.height}`, maxHeight: "75vh" }}
    >
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
      {/*
        Unconditional now, not gated behind node.canEdit — "🗂 Groups" and "📋
        Markers" are both personal browse/display tools (which categories of
        markers YOU currently see, finding a marker by name), useful to a
        player as much as a DM, so neither can live inside the edit-only
        block the way "Replace image"/shape-adder/Done-Cancel legitimately do.
      */}
      {/*
        Wraps onto a second row instead of shrinking: with the edit controls
        open there are more buttons than a narrow map has room for, and a
        shrinking row both broke labels over two lines and slid left over
        Leaflet's zoom buttons. z-[1001] keeps its dropdowns (Presets) above
        the marker inspector, which sits at z-[1000] below it.
      */}
      <div className="absolute right-3 top-3 z-[1001] flex max-w-[calc(100%-4.5rem)] flex-wrap justify-end gap-1 rounded-md border border-line bg-surface/95 p-1 shadow-lg [&_button]:whitespace-nowrap">
        <button
          type="button"
          onClick={() => setOpenPanel(openPanel === "groups" ? null : "groups")}
          title="Show/hide marker groups"
          className={`rounded px-2 py-1 text-xs ${
            openPanel === "groups" ? "bg-accent text-on-accent" : "text-fg-soft hover:bg-press"
          }`}
        >
          🗂 Groups
        </button>
        <button
          type="button"
          onClick={() => setOpenPanel(openPanel === "markers" ? null : "markers")}
          title="Browse markers on this map"
          className={`rounded px-2 py-1 text-xs ${
            openPanel === "markers" ? "bg-accent text-on-accent" : "text-fg-soft hover:bg-press"
          }`}
        >
          📋 Markers
        </button>
        <button
          type="button"
          onClick={() => {
            if (measurePoints !== null) {
              setMeasurePoints(null);
              return;
            }
            setDropShape(null);
            setActivePreset(null);
            setDraft(null);
            setFogPanelOpen(false);
            setMeasurePoints([]);
          }}
          title="Measure distances on this map"
          className={`rounded px-2 py-1 text-xs ${
            measurePoints !== null ? "bg-accent text-on-accent" : "text-fg-soft hover:bg-press"
          }`}
        >
          📏 Measure
        </button>
        {isGameMaster && (
          <button
            type="button"
            onClick={() => {
              if (!fogPanelOpen) {
                setMeasurePoints(null);
                setDropShape(null);
                setActivePreset(null);
                setDraft(null);
              }
              setFogPanelOpen(!fogPanelOpen);
            }}
            title="Fog of war: hide parts of this map from players"
            className={`rounded px-2 py-1 text-xs ${
              fogPanelOpen ? "bg-accent text-on-accent" : map.fogEnabled ? "text-fg-strong hover:bg-press" : "text-fg-soft hover:bg-press"
            }`}
          >
            🌫 Fog{map.fogEnabled ? " ●" : ""}
          </button>
        )}
        {node.canEdit && (
          <>
            <div className="mx-0.5 w-px self-stretch bg-line" />
            <button
              type="button"
              onClick={() => setEditToolbarOpen(!editToolbarOpen)}
              // A draft in progress keeps its Done/Cancel controls reachable
              // even if this gets collapsed mid-draw — see the `|| draft
              // !== null` on the block below, not just this highlight.
              title="Show/hide map editing controls"
              className={`rounded px-2 py-1 text-xs ${
                editToolbarOpen || draft !== null ? "bg-accent text-on-accent" : "text-fg-soft hover:bg-press"
              }`}
            >
              ✏️ Edit
            </button>
          </>
        )}
        {node.canEdit && (editToolbarOpen || draft !== null) && (
          <>
            <div className="mx-0.5 w-px self-stretch bg-line" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={upload.isPending}
              title="Replace this map's source image"
              className="rounded px-2 py-1 text-xs text-fg-soft hover:bg-press disabled:opacity-50"
            >
              {upload.isPending ? "Uploading…" : "🖼 Replace image"}
            </button>
            <div className="mx-0.5 w-px self-stretch bg-line" />
            {ADDABLE_SHAPES.map((shape) =>
              (DRAW_SHAPES as readonly string[]).includes(shape) ? (
                <button
                  key={shape}
                  type="button"
                  onClick={() => {
                    setActivePreset(null);
                    startDraft(shape as DrawShape);
                  }}
                  className={`rounded px-2 py-1 text-xs ${
                    draft?.shape === shape && activePreset === null ? "bg-violet-solid text-white" : "text-fg-soft hover:bg-press"
                  }`}
                >
                  ✏ {SHAPE_LABEL[shape]}
                </button>
              ) : (
                <button
                  key={shape}
                  type="button"
                  onClick={() => {
                    setActivePreset(null);
                    setMeasurePoints(null);
                    setFogPanelOpen(false);
                    setDropShape(dropShape === shape && activePreset === null ? null : shape);
                  }}
                  className={`rounded px-2 py-1 text-xs ${
                    dropShape === shape && activePreset === null ? "bg-accent text-on-accent" : "text-fg-soft hover:bg-press"
                  }`}
                >
                  + {SHAPE_LABEL[shape]}
                </button>
              ),
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPresetMenuOpen(!presetMenuOpen)}
                title="Place a marker from one of this world's presets"
                className={`rounded px-2 py-1 text-xs ${
                  activePreset !== null || presetMenuOpen ? "bg-accent text-on-accent" : "text-fg-soft hover:bg-press"
                }`}
              >
                ★ {activePreset !== null ? activePreset.name : "Presets"}
              </button>
              {presetMenuOpen && (
                <>
                  <div className="fixed inset-0 z-[1002]" onClick={() => setPresetMenuOpen(false)} />
                  <div className="absolute right-0 z-[1003] mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-line bg-raised py-1 shadow-pop">
                    {(presetsQuery.data?.presets ?? []).length === 0 ? (
                      <p className="px-3 py-2 text-xs text-fg-muted">
                        No presets yet.{" "}
                        {isGameMaster
                          ? "Style a marker, then use “Save look as preset” in its inspector."
                          : "The owner or a DM can make some."}
                      </p>
                    ) : (
                      (presetsQuery.data?.presets ?? []).map((preset) => (
                        <div key={preset.id} className="group flex items-center">
                          <button type="button" onClick={() => placeFromPreset(preset)} className="menu-item">
                            <PresetSwatch preset={preset} />
                            <span className="truncate">{preset.name}</span>
                            <span className="ml-auto text-[10px] text-fg-faint">{SHAPE_LABEL[preset.shape]}</span>
                          </button>
                          {isGameMaster && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Delete the "${preset.name}" preset? Markers already placed with it stay as they are.`)) {
                                  removePreset.mutate(preset.id);
                                }
                              }}
                              title="Delete this preset"
                              aria-label={`Delete preset ${preset.name}`}
                              className="hidden shrink-0 px-2 text-xs text-fg-muted hover:text-danger group-hover:block"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            {draft !== null && (
              <>
                <button
                  type="button"
                  onClick={() => finishDraft(draft.points)}
                  className="rounded bg-success-solid px-2 py-1 text-xs text-white hover:bg-success-solid-hover"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={cancelDraft}
                  className="rounded px-2 py-1 text-xs text-danger-soft hover:bg-press"
                >
                  Cancel
                </button>
              </>
            )}
          </>
        )}
      </div>
      {uploadError !== null && (
        <div className="absolute right-3 top-14 z-[1000] max-w-xs rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-xs text-danger shadow-lg">
          {uploadError}
        </div>
      )}
      {openPanel === "groups" && (
        <MapGroupsPanel
          groups={groups}
          hiddenGroups={hiddenGroups}
          canEdit={node.canEdit}
          onClose={() => setOpenPanel(null)}
          onCreate={(name, parentGroupId) => createGroup.mutate({ name, parentGroupId })}
          onRename={(id, name) => updateGroup.mutate({ id, name })}
          onMove={(id, input) => moveGroup.mutate({ id, ...input })}
          onDelete={(id) => removeGroup.mutate(id)}
        />
      )}
      {openPanel === "markers" && (
        <MarkerListPanel
          markers={markers}
          groups={groups}
          scale={scale}
          onClose={() => setOpenPanel(null)}
          onSelect={(marker) => {
            setSelectedId(marker.id);
            const anchor =
              marker.shape === "polygon" || marker.shape === "path" ? anchorFor(marker) : { x: marker.x, y: marker.y };
            if (anchor !== null) mapInstanceRef.current?.panTo(pixelToLatLng(anchor.x, anchor.y, scale));
          }}
        />
      )}

      <MapContainer
        key={node.id}
        ref={mapInstanceRef}
        crs={PIXEL_CRS}
        bounds={bounds!}
        // The actual cause of the "black bar": Leaflet's default zoomSnap=1
        // only ever lands on whole zoom levels, and this container's pixel
        // size essentially never exactly matches what a whole zoom level's
        // tile grid needs — so fitBounds() picks the largest whole zoom that
        // still fits, centers it, and leaves the leftover width or height as
        // plain container background. zoomSnap={0} lets it land on whatever
        // fractional zoom actually fills the container exactly, the same
        // technique every CRS.Simple single-image viewer needs.
        zoomSnap={0}
        maxBounds={panBounds!}
        maxBoundsViscosity={0.8}
        minZoom={effectiveMinZoom}
        // Untiled maps (small enough to skip the tiling pipeline) get a much
        // bigger buffer above their nominal max zoom than tiled ones: there's
        // no real pyramid to run out of, just the browser scaling up one
        // image, so there's no reason to stop the user from zooming in to
        // read fine detail just because the buffer used to be small. It gets
        // soft past native resolution, same as zooming into any raster image
        // — that's expected, not a bug, and still strictly better than a
        // hard wall stopping them from zooming in at all.
        maxZoom={computedMaxZoom}
        className="h-full w-full bg-canvas"
        // Tiles are the DM's own uploaded map image, not a third-party
        // source (OSM etc.) that requires attribution — nothing to credit.
        attributionControl={false}
      >
        <ZoomWatcher onChange={setZoomState} />
        <MapOptionsSync
          minZoom={effectiveMinZoom}
          maxZoom={computedMaxZoom}
          maxBounds={panBounds!}
          maxBoundsViscosity={0.8}
          fitBounds={bounds!}
        />
        {map.tilingStatus === "ready" ? (
          <TileLayer
            key={map.assetUrl}
            // See mapTileUrlTemplate's own comment (packages/schema) for why
            // this is {z}/{y}/{x} and not the more-familiar {z}/{x}/{y} — and
            // docs/HANDOFF.md §7.8 for the bug this fixed.
            url={
              map.fogEnabled && !isGameMaster
                ? // The server darkens a player's tiles; `v` busts the browser cache when the fog
                  // changes, and `as=player` makes a DM's "view as a player" preview get the same
                  // tiles (it only ever narrows, so it's a no-op for a real player).
                  `${mapTileUrlTemplate(node.id)}?v=${map.fogVersion ?? ""}&as=player`
                : mapTileUrlTemplate(node.id)
            }
            minZoom={map.minZoom}
            maxZoom={map.maxZoom}
            tileSize={256}
            noWrap
            // sharp's tiler pads every zoom level out to a square grid
            // (`.tile()`'s own requirement) with transparent pixels beyond
            // the real image — for any non-square map, that padding is real
            // tile content, not a layout bug, and shows through as a "black"
            // bar (actually the map container's own dark background) unless
            // something stops Leaflet from requesting/rendering tiles past
            // the actual image. `bounds` is exactly that: it's a real
            // TileLayer option, not just a MapContainer one — it skips any
            // tile whose geographic extent falls outside it.
            bounds={bounds!}
          />
        ) : (
          <ImageOverlay url={map.assetUrl} bounds={bounds!} />
        )}
        {(map.tilingStatus === "pending" || map.tilingStatus === "running") && (
          // top-14, not top-3: the shape toolbar sits at top-3 spanning most of
          // the width, and a left-anchored banner at that same row collided
          // with its Done/Cancel buttons on anything but a wide window.
          <div className="absolute left-3 top-14 z-[1000] rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-xs text-fg-subtle">
            Tiling this map for smoother zoom…
          </div>
        )}
        {isGameMaster && map.fogEnabled && (
          <FogEditorLayer
            map={map}
            markers={markers}
            bounds={bounds!}
            pixelScale={scale}
            tool={fogPanelOpen ? fogTool : null}
            brushPx={fogBrushPx}
            fillRequest={fogFill}
            onSaved={() => {
              setFogSaveState("Saved");
              invalidateMap();
            }}
            onSaveError={setFogSaveState}
          />
        )}
        {measurePoints !== null && (
          <MeasureLayer
            points={measurePoints}
            mode={measureMode}
            mapScale={map.scale}
            pixelScale={scale}
            onChange={setMeasurePoints}
          />
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
          // top-24: below both the toolbar (top-3) and the tiling banner
          // (top-14), so the two never fight for the same row even if both
          // happen to be visible at once (drawing while a large image is
          // still tiling in the background).
          <div className="absolute left-3 top-24 z-[1000] max-w-md rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-xs text-fg-soft">
            {draft !== null ? (
              <>
                Drawing a {SHAPE_LABEL[draft.shape]?.toLowerCase() ?? draft.shape} — click to add points, Ctrl+Z to
                undo the last point, double-click or Done to finish, Esc to cancel.{" "}
                {draftError !== null && <span className="text-danger">{draftError}</span>}
              </>
            ) : (
              <>
                Click to place {activePreset !== null ? `a “${activePreset.name}”` : `a ${SHAPE_LABEL[dropShape ?? ""]?.toLowerCase() ?? ""}`}, or
                pick another shape to change.
              </>
            )}
          </div>
        )}
        {drawnMarkers.map((marker) =>
          draft !== null && draft.replaceId === marker.id ? null : marker.shape === "polygon" || marker.shape === "path" ? (
            <PolygonShapeMarker
              key={marker.id}
              marker={marker}
              canEdit={node.canEdit}
              isEditing={selectedId === marker.id}
              scale={scale}
              onSelect={() => setSelectedId(marker.id)}
              onMoveAnchor={
                node.canEdit
                  ? (x, y) => update.mutate({ id: marker.id, x, y })
                  : undefined
              }
              onUpdatePoints={
                node.canEdit
                  ? (points) => update.mutate({ id: marker.id, points: formatMarkerPoints(points) })
                  : undefined
              }
            />
          ) : marker.shape === "circle" ? (
            // Circle, not CircleMarker: radius must scale with zoom (a circle
            // covering half the map at zoom 0 should still cover half the map
            // at zoom 4), matching how polygon/path vertices already behave.
            <Circle
              key={marker.id}
              center={pixelToLatLng(marker.x, marker.y, scale)}
              radius={(marker.radius ?? DEFAULT_CIRCLE_RADIUS_PX) / scale}
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

      {fogPanelOpen && isGameMaster && (
        <FogPanel
          map={map}
          tool={fogTool}
          brushPx={fogBrushPx}
          saveState={fogSaveState}
          onToggleFog={(enabled) => toggleFog.mutate(enabled)}
          onToolChange={setFogTool}
          onBrushChange={setFogBrushPx}
          onFill={(fill) => setFogFill((prev) => ({ seq: (prev?.seq ?? 0) + 1, fill }))}
          onClose={() => setFogPanelOpen(false)}
        />
      )}

      {measurePoints !== null && (
        <MeasurePanel
          points={measurePoints}
          mode={measureMode}
          mapScale={map.scale}
          canCalibrate={node.canEdit}
          onModeChange={setMeasureMode}
          onChange={setMeasurePoints}
          onSaveScale={(next) => saveScale.mutate(next)}
          onClose={() => setMeasurePoints(null)}
        />
      )}

      {selected !== null && (
        <MarkerInspector
          // Keyed so switching markers resets its local form state (label,
          // color, zoom range drafts) instead of carrying the last one's over.
          key={selected.id}
          marker={selected}
          allNodes={allNodes}
          markers={markers}
          groups={groups}
          canEdit={node.canEdit}
          onClose={() => setSelectedId(null)}
          onSave={(input) => update.mutate({ id: selected.id, ...input })}
          onDelete={() => remove.mutate(selected.id)}
          onRedraw={
            node.canEdit && (selected.shape === "polygon" || selected.shape === "path")
              ? () => startDraft(selected.shape as DrawShape, selected.id)
              : undefined
          }
          magnification={magnification}
          canRevealFog={isGameMaster && map.fogEnabled}
          onSavePreset={
            isGameMaster
              ? (name) =>
                  savePreset.mutate({
                    name,
                    shape: selected.shape,
                    icon: selected.icon,
                    color: selected.color,
                    radius: selected.shape === "circle" ? selected.radius : null,
                  })
              : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * Which map groups this viewer has personally toggled off — a display
 * preference, not a permission (per the owner's explicit choice: unlike a
 * group's membership/color/order, which are shared map data everyone sees
 * the same way, hiding "Regions" to declutter your own screen shouldn't hide
 * it for the DM or anyone else). Same reasoning and same localStorage
 * mechanism as App.tsx's usePinned, keyed per map node since different maps
 * have different groups.
 */
function useHiddenMapGroups(mapNodeId: string) {
  const storageKey = `dwa:hiddenMapGroups:${mapNodeId}`;
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw !== null ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  function persist(next: Set<string>): void {
    setHiddenIds(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Best-effort — a full quota or private browsing just means the toggle doesn't stick around.
    }
  }
  function toggle(groupId: string): void {
    const next = new Set(hiddenIds);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    persist(next);
  }
  return { hiddenIds, toggle };
}

const FAVORITE_COLORS_KEY = "dwa:favoriteColors";

/** A personal palette, same reasoning as App.tsx's usePinned: view preference, not campaign content. */
function useFavoriteColors() {
  const [favorites, setFavorites] = useState<Array<{ name: string; color: string }>>(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITE_COLORS_KEY);
      return raw !== null ? (JSON.parse(raw) as Array<{ name: string; color: string }>) : [];
    } catch {
      return [];
    }
  });
  function persist(next: Array<{ name: string; color: string }>): void {
    setFavorites(next);
    try {
      window.localStorage.setItem(FAVORITE_COLORS_KEY, JSON.stringify(next));
    } catch {
      // Best-effort — a full quota or private browsing just means favorites don't stick around.
    }
  }
  return {
    favorites,
    add: (name: string, color: string) => persist([...favorites, { name, color }]),
    remove: (index: number) => persist(favorites.filter((_, i) => i !== index)),
  };
}

/**
 * Kanka's own MapGroup panel — a nested checklist of display categories.
 * Checking/unchecking is purely local (see useHiddenMapGroups); everything
 * else (name, color swatch, nesting, order) is shared map data, edited only
 * when `canEdit`. "Later sort_key paints on top" is stated plainly in the UI
 * rather than encoded into an "up means what" convention that would need
 * memorizing — the ▲/▼ buttons just say what they do in their title.
 */
function MapGroupsPanel({
  groups,
  hiddenGroups,
  canEdit,
  onClose,
  onCreate,
  onRename,
  onMove,
  onDelete,
}: {
  groups: MapGroupDto[];
  hiddenGroups: { hiddenIds: Set<string>; toggle: (id: string) => void };
  canEdit: boolean;
  onClose: () => void;
  onCreate: (name: string, parentGroupId: string | null) => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, input: { afterId: string | null; beforeId: string | null }) => void;
  onDelete: (id: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addingChildTo, setAddingChildTo] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [addingTopLevel, setAddingTopLevel] = useState(false);

  function siblingsOf(parentGroupId: string | null): MapGroupDto[] {
    return groups
      .filter((g) => g.parentGroupId === parentGroupId)
      .slice()
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  }

  function move(group: MapGroupDto, direction: "earlier" | "later"): void {
    const siblings = siblingsOf(group.parentGroupId);
    const idx = siblings.findIndex((g) => g.id === group.id);
    if (idx === -1) return;
    if (direction === "earlier") {
      if (idx === 0) return;
      const prev = siblings[idx - 1]!;
      const prevPrev = siblings[idx - 2] ?? null;
      onMove(group.id, { afterId: prevPrev?.id ?? null, beforeId: prev.id });
    } else {
      if (idx === siblings.length - 1) return;
      const next = siblings[idx + 1]!;
      const nextNext = siblings[idx + 2] ?? null;
      onMove(group.id, { afterId: next.id, beforeId: nextNext?.id ?? null });
    }
  }

  function submitNewChild(parentGroupId: string | null): void {
    if (newName.trim().length === 0) return;
    onCreate(newName.trim(), parentGroupId);
    setNewName("");
    setAddingChildTo(null);
    setAddingTopLevel(false);
  }

  function renderGroup(group: MapGroupDto, depth: number) {
    const siblings = siblingsOf(group.parentGroupId);
    const idx = siblings.findIndex((g) => g.id === group.id);
    const children = siblingsOf(group.id);
    return (
      <div key={group.id}>
        <div
          className="group flex items-center gap-1.5 rounded px-1 py-1 text-xs text-fg-soft hover:bg-hover"
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          <input
            type="checkbox"
            checked={!hiddenGroups.hiddenIds.has(group.id)}
            onChange={() => hiddenGroups.toggle(group.id)}
            className="shrink-0 accent-accent"
          />
          {group.color !== null && (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-canvas" style={{ background: group.color }} />
          )}
          {renamingId === group.id ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => {
                if (renameValue.trim().length > 0) onRename(group.id, renameValue.trim());
                setRenamingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenamingId(null);
              }}
              className="min-w-0 flex-1 rounded border border-line-strong bg-canvas px-1 text-fg-strong outline-none"
            />
          ) : (
            <span
              className={`min-w-0 flex-1 truncate ${canEdit ? "cursor-pointer" : ""}`}
              onClick={() => {
                if (!canEdit) return;
                setRenamingId(group.id);
                setRenameValue(group.name);
              }}
            >
              {group.name}
            </span>
          )}
          {canEdit && (
            <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
              <button type="button" title="Paint earlier (further back)" onClick={() => move(group, "earlier")} disabled={idx <= 0} className="px-1 text-fg-muted hover:text-fg disabled:opacity-30">
                ▲
              </button>
              <button type="button" title="Paint later (further forward)" onClick={() => move(group, "later")} disabled={idx === siblings.length - 1} className="px-1 text-fg-muted hover:text-fg disabled:opacity-30">
                ▼
              </button>
              <button type="button" title="Add a group nested under this one" onClick={() => { setAddingChildTo(group.id); setNewName(""); }} className="px-1 text-fg-muted hover:text-fg">
                +
              </button>
              <button type="button" title="Delete this group (markers are ungrouped, not deleted)" onClick={() => onDelete(group.id)} className="px-1 text-danger-soft hover:text-danger">
                ✕
              </button>
            </div>
          )}
        </div>
        {addingChildTo === group.id && (
          <div className="flex items-center gap-1" style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewChild(group.id);
                if (e.key === "Escape") setAddingChildTo(null);
              }}
              placeholder="New group name"
              className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-fg outline-none focus:border-line-strong"
            />
            <button type="button" onClick={() => submitNewChild(group.id)} className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-on-accent">
              Add
            </button>
          </div>
        )}
        {children.map((child) => renderGroup(child, depth + 1))}
      </div>
    );
  }

  const topLevel = siblingsOf(null);

  return (
    <div className="absolute bottom-3 left-3 z-[1000] w-64 rounded-md border border-line bg-surface p-3 shadow-2xl">
      <div className="mb-1 flex items-center">
        <h3 className="text-sm font-semibold text-fg-strong">Groups</h3>
        <button type="button" onClick={onClose} className="ml-auto text-xs text-fg-muted hover:text-fg">
          Close
        </button>
      </div>
      <p className="mb-2 text-[10px] text-fg-muted">
        Checking a group only changes what you see. Later in the list paints on top.
      </p>
      {topLevel.length === 0 ? (
        <p className="py-2 text-xs text-fg-muted">No groups yet.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">{topLevel.map((g) => renderGroup(g, 0))}</div>
      )}
      {canEdit &&
        (addingTopLevel ? (
          <div className="mt-2 flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNewChild(null);
                if (e.key === "Escape") setAddingTopLevel(false);
              }}
              placeholder="New group name"
              className="min-w-0 flex-1 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-fg outline-none focus:border-line-strong"
            />
            <button type="button" onClick={() => submitNewChild(null)} className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-on-accent">
              Add
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setAddingTopLevel(true);
              setNewName("");
            }}
            className="mt-2 w-full rounded border border-line px-2 py-1 text-xs text-fg-soft hover:bg-hover"
          >
            + New group
          </button>
        ))}
    </div>
  );
}

/**
 * A flat, searchable browse list of every marker on the map — the thing
 * `MapGroupsPanel` deliberately isn't (that's a *category* filter, not a
 * finder). Clicking a row selects the marker (opens `MarkerInspector`, same
 * as clicking it on the map) and pans the map to it, so a marker buried
 * somewhere on a large image is reachable by name instead of by scrolling
 * around looking for it.
 */
function MarkerListPanel({
  markers,
  groups,
  scale,
  onClose,
  onSelect,
}: {
  markers: MapMarkerDto[];
  groups: MapGroupDto[];
  scale: number;
  onClose: () => void;
  onSelect: (marker: MapMarkerDto) => void;
}) {
  const [query, setQuery] = useState("");
  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  function nameOf(marker: MapMarkerDto): string {
    return marker.label ?? marker.targetNode?.title ?? SHAPE_LABEL[marker.shape] ?? marker.shape;
  }
  function iconTextOf(marker: MapMarkerDto): string {
    // Same fallback order as `iconFor`'s on-map badge — a token defaults to
    // the flag, everything else (including region/path, which don't render
    // a point badge on the map at all) to a generic pin.
    return marker.icon ?? marker.targetNode?.icon ?? (marker.shape === "token" ? DEFAULT_TOKEN_ICON : "📍");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return markers
      .filter((m) => q.length === 0 || nameOf(m).toLowerCase().includes(q))
      .slice()
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, query]);

  return (
    <div className="absolute bottom-3 left-3 z-[1000] w-72 rounded-md border border-line bg-surface p-3 shadow-2xl">
      <div className="mb-2 flex items-center">
        <h3 className="text-sm font-semibold text-fg-strong">Markers</h3>
        <button type="button" onClick={onClose} className="ml-auto text-xs text-fg-muted hover:text-fg">
          Close
        </button>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a marker by name…"
        className="mb-2 w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-line-strong"
      />
      {markers.length === 0 ? (
        <p className="py-2 text-xs text-fg-muted">No markers on this map yet.</p>
      ) : filtered.length === 0 ? (
        <p className="py-2 text-xs text-fg-muted">No markers match "{query}".</p>
      ) : (
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {filtered.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-fg hover:bg-press"
            >
              <Glyph icon={iconTextOf(m)} className="w-4 shrink-0 text-center" />
              <span className="min-w-0 flex-1 truncate">{nameOf(m)}</span>
              {m.groupId !== null && groupsById.get(m.groupId) !== undefined && (
                <span className="shrink-0 truncate text-[10px] text-fg-muted">{groupsById.get(m.groupId)!.name}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MarkerInspector({
  marker,
  allNodes,
  markers,
  groups,
  canEdit,
  onClose,
  onSave,
  onDelete,
  onRedraw,
  onSavePreset,
  magnification,
  canRevealFog,
}: {
  marker: MapMarkerDto;
  allNodes: NodeSummary[];
  markers: MapMarkerDto[];
  groups: MapGroupDto[];
  canEdit: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof api.updateMarker>[1]) => void;
  onDelete: () => void;
  onRedraw?: () => void;
  /** Owner/DM only: store this marker's shape/icon/color as a world-wide preset. */
  onSavePreset?: (name: string) => void;
  /** The map's current and allowed zoom, as magnification (0 = 100%) — bounds the zoom-range slider. */
  magnification: { current: number; min: number; max: number } | null;
  /** Owner/DM on a map with fog on: a region can be marked as clearing the fog inside it. */
  canRevealFog: boolean;
}) {
  const [presetName, setPresetName] = useState<string | null>(null);
  const [label, setLabel] = useState(marker.label ?? "");
  const [color, setColor] = useState(marker.color ?? "");
  const [radius, setRadius] = useState(marker.radius ?? DEFAULT_CIRCLE_RADIUS_PX);
  const [members, setMembers] = useState(marker.members ?? "");
  const [namingFavorite, setNamingFavorite] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const favoriteColors = useFavoriteColors();

  /**
   * A token's own descendants (and itself) can't be offered as its parent —
   * that would create a cycle, which the server also refuses, but there's no
   * reason to let the UI offer an option it already knows is invalid. Other
   * shapes never have children (nothing else can be grouped), so this is
   * only ever non-trivial for tokens.
   */
  const invalidParentIds = useMemo(() => {
    const byParent = new Map<string, MapMarkerDto[]>();
    for (const m of markers) {
      if (m.parentMarkerId !== null) byParent.set(m.parentMarkerId, [...(byParent.get(m.parentMarkerId) ?? []), m]);
    }
    const invalid = new Set<string>([marker.id]);
    const stack = [marker.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      for (const child of byParent.get(id) ?? []) {
        if (!invalid.has(child.id)) {
          invalid.add(child.id);
          stack.push(child.id);
        }
      }
    }
    return invalid;
  }, [markers, marker.id]);
  const groupOptions = markers.filter((m) => m.shape === "token" && !invalidParentIds.has(m.id));

  return (
    // Bottom-anchored and growing upward, so it's capped short of the toolbar
    // (up to two rows tall now that it wraps) and scrolls past that instead.
    <div className="absolute bottom-3 right-3 z-[1000] max-h-[calc(100%-6rem)] w-72 overflow-y-auto rounded-md border border-line bg-surface p-4 shadow-2xl">
      <div className="mb-2 flex items-center">
        <h3 className="text-sm font-semibold text-fg-strong">{SHAPE_LABEL[marker.shape] ?? marker.shape}</h3>
        <button type="button" onClick={onClose} className="ml-auto text-xs text-fg-muted hover:text-fg">
          Close
        </button>
      </div>

      {marker.targetNode !== null && (
        <button
          type="button"
          onClick={() => navigate(`/n/${marker.targetNode!.id}`)}
          className="mb-2 flex w-full items-center gap-1 rounded bg-hover px-2 py-1.5 text-left text-xs text-fg-soft hover:bg-hover-strong"
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
              className="w-full rounded border border-line-strong bg-hover px-2 py-1 text-xs text-fg-soft hover:bg-hover-strong"
            >
              ✏ Redraw shape
            </button>
          )}
          <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
            Link to a page
            <select
              value={marker.targetNode?.id ?? ""}
              onChange={(e) => onSave({ targetNodeId: e.target.value.length > 0 ? e.target.value : null })}
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-fg"
            >
              <option value="">— none —</option>
              {allNodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
            Label override
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => onSave({ label: label.length > 0 ? label : null })}
              placeholder={marker.targetNode?.title ?? ""}
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-line-strong"
            />
          </label>

          {marker.shape !== "label" && marker.shape !== "polygon" && marker.shape !== "path" && (
            <div>
              <span className="block text-[10px] uppercase tracking-wide text-fg-muted">Icon override</span>
              <div className="mt-1 flex items-center gap-2 rounded border border-line bg-canvas px-1 py-0.5">
                <IconPicker
                  value={marker.icon}
                  disabled={false}
                  onChange={(icon) => onSave({ icon })}
                  allowLibrary
                  fallback={marker.targetNode?.icon ?? (marker.shape === "token" ? DEFAULT_TOKEN_ICON : "📍")}
                />
                <span className="text-[10px] text-fg-muted">
                  {marker.icon !== null ? "Click to change" : marker.targetNode !== null ? "From the linked page" : "Click to pick"}
                </span>
              </div>
            </div>
          )}

          <div>
            <span className="block text-[10px] uppercase tracking-wide text-fg-muted">Color</span>
            <div className="mt-1 flex gap-1">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#3d5ab5"}
                onChange={(e) => {
                  setColor(e.target.value);
                  onSave({ color: e.target.value });
                }}
                title="Pick a color"
                className="h-[26px] w-8 shrink-0 cursor-pointer rounded border border-line bg-canvas p-0.5"
              />
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                onBlur={() => onSave({ color: color.length > 0 ? color : null })}
                placeholder="#3d5ab5"
                className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-line-strong"
              />
              <button
                type="button"
                onClick={() => setNamingFavorite(true)}
                title="Save this color as a favorite"
                className="shrink-0 rounded border border-line px-1.5 text-xs text-fg-muted hover:text-fg"
              >
                +
              </button>
            </div>
            {namingFavorite && (
              <div className="mt-1 flex gap-1">
                <input
                  autoFocus
                  value={favoriteName}
                  onChange={(e) => setFavoriteName(e.target.value)}
                  placeholder="Name this color"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && favoriteName.trim().length > 0 && color.length > 0) {
                      favoriteColors.add(favoriteName.trim(), color);
                      setFavoriteName("");
                      setNamingFavorite(false);
                    }
                    if (e.key === "Escape") setNamingFavorite(false);
                  }}
                  className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-line-strong"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (favoriteName.trim().length > 0 && color.length > 0) {
                      favoriteColors.add(favoriteName.trim(), color);
                      setFavoriteName("");
                      setNamingFavorite(false);
                    }
                  }}
                  className="shrink-0 rounded bg-accent px-2 text-xs text-on-accent hover:bg-accent-hover"
                >
                  Save
                </button>
              </div>
            )}
            {favoriteColors.favorites.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {favoriteColors.favorites.map((f, i) => (
                  <button
                    key={`${f.name}-${i}`}
                    type="button"
                    onClick={() => {
                      setColor(f.color);
                      onSave({ color: f.color });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (window.confirm(`Remove "${f.name}" from favorites?`)) favoriteColors.remove(i);
                    }}
                    title={`${f.name} (${f.color}) — right-click to remove`}
                    className="h-5 w-5 rounded-full border border-line"
                    style={{ background: f.color }}
                  />
                ))}
              </div>
            )}
          </div>

          {marker.shape === "circle" && (
            <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
              Size ({Math.round(radius)}px)
              <input
                type="range"
                min={MIN_CIRCLE_RADIUS_PX}
                max={MAX_CIRCLE_RADIUS_PX}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                onMouseUp={() => onSave({ radius })}
                onKeyUp={() => onSave({ radius })}
                className="mt-1 w-full accent-accent"
              />
            </label>
          )}

          {marker.shape === "token" && (
            <>
              <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
                Group (parent token)
                <select
                  value={marker.parentMarkerId ?? ""}
                  onChange={(e) => onSave({ parentMarkerId: e.target.value.length > 0 ? e.target.value : null })}
                  className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-fg"
                >
                  <option value="">— none (top-level) —</option>
                  {groupOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label ?? m.targetNode?.title ?? "(untitled token)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
                Who's in this group
                <textarea
                  value={members}
                  onChange={(e) => setMembers(e.target.value)}
                  onBlur={() => onSave({ members: members.length > 0 ? members : null })}
                  placeholder="e.g. Kael, Brint, 4 mercenaries"
                  rows={2}
                  className="mt-1 w-full resize-y rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-line-strong"
                />
              </label>
            </>
          )}

          {groups.length > 0 && (
            <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
              Display group
              <select
                value={marker.groupId ?? ""}
                onChange={(e) => onSave({ groupId: e.target.value.length > 0 ? e.target.value : null })}
                className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-fg"
              >
                <option value="">— ungrouped —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-[10px] uppercase tracking-wide text-fg-muted">
            Visibility
            <select
              value={marker.visibility}
              onChange={(e) => onSave({ visibility: e.target.value as FieldVisibility })}
              className="mt-1 w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-fg"
            >
              {(Object.keys(VISIBILITY_LABEL) as FieldVisibility[]).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </option>
              ))}
            </select>
          </label>

          {canRevealFog && marker.shape === "polygon" && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
              <input
                type="checkbox"
                checked={marker.revealed}
                onChange={(e) => onSave({ revealed: e.target.checked })}
                className="accent-accent"
              />
              Reveals the fog inside it
            </label>
          )}

          {magnification !== null && (
            <ZoomRangeControl
              minZoom={marker.minZoom}
              maxZoom={marker.maxZoom}
              magnification={magnification}
              onChange={(range) => onSave(range)}
            />
          )}

          {onSavePreset !== undefined &&
            (presetName === null ? (
              <button
                type="button"
                onClick={() => setPresetName(marker.label ?? marker.targetNode?.title ?? "")}
                title="Reuse this shape, icon and color for new markers on any map in this world"
                className="w-full rounded border border-line px-2 py-1 text-xs text-fg-soft hover:bg-press"
              >
                ★ Save look as preset
              </button>
            ) : (
              <form
                className="flex gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (presetName.trim().length === 0) return;
                  onSavePreset(presetName.trim());
                  setPresetName(null);
                }}
              >
                <input
                  autoFocus
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setPresetName(null);
                  }}
                  placeholder="Preset name, e.g. Tavern"
                  aria-label="Preset name"
                  className="min-w-0 flex-1 rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-line-strong"
                />
                <button type="submit" className="shrink-0 rounded bg-accent px-2 text-xs text-on-accent hover:bg-accent-hover">
                  Save
                </button>
              </form>
            ))}

          <button
            type="button"
            onClick={onDelete}
            className="w-full rounded border border-line px-2 py-1 text-xs text-danger-soft hover:bg-press"
          >
            Delete marker
          </button>
        </div>
      ) : (
        <p className="text-xs text-fg-subtle">{marker.label ?? "(untitled)"}</p>
      )}
    </div>
  );
}

/** 2^z as a percentage, the way people think about zoom: -1 → "50%". */
function zoomPercent(z: number): string {
  const pct = Math.pow(2, z) * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}

/**
 * "Visible at zoom" — a two-thumb range over everything this map can zoom to.
 * A thumb parked at its end of the track means "no limit that way" (null),
 * so a marker can be "only when zoomed in past 50%" without also picking an
 * arbitrary upper bound. The track is padded half a step past the map's own
 * limits so those "no limit" positions are distinct from the real extremes.
 */
function ZoomRangeControl({
  minZoom,
  maxZoom,
  magnification,
  onChange,
}: {
  minZoom: number | null;
  maxZoom: number | null;
  magnification: { current: number; min: number; max: number };
  onChange: (range: { minZoom: number | null; maxZoom: number | null }) => void;
}) {
  const STEP = 0.25;
  // Capped at 800%: an untiled map lets you zoom far past its native pixels
  // (it just gets blurry), and a track running to 25600% would squash every
  // useful setting into its first few millimetres.
  const lo = Math.floor(magnification.min / STEP) * STEP - STEP;
  const hi = Math.ceil(Math.min(magnification.max, 3) / STEP) * STEP + STEP;
  const [low, setLow] = useState(minZoom ?? lo);
  const [high, setHigh] = useState(maxZoom ?? hi);

  function commit(nextLow: number, nextHigh: number): void {
    onChange({ minZoom: nextLow <= lo ? null : nextLow, maxZoom: nextHigh >= hi ? null : nextHigh });
  }

  const now = Math.round(magnification.current / STEP) * STEP;
  const summary =
    low <= lo && high >= hi
      ? "Always visible"
      : low <= lo
        ? `Up to ${zoomPercent(high)}`
        : high >= hi
          ? `From ${zoomPercent(low)} in`
          : `${zoomPercent(low)} – ${zoomPercent(high)}`;
  const pct = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="block text-[10px] uppercase tracking-wide text-fg-muted">Visible at zoom</span>
        <span className="text-[10px] text-fg-soft">{summary}</span>
      </div>
      <div className="dual-range relative mt-1 h-5">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-line" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-accent"
          style={{ left: pct(low), right: `calc(100% - ${pct(high)})` }}
        />
        <div
          className="absolute top-0 h-5 w-px bg-fg-faint"
          style={{ left: pct(now) }}
          title={`You're at ${zoomPercent(magnification.current)}`}
        />
        <input
          type="range"
          min={lo}
          max={hi}
          step={STEP}
          value={low}
          aria-label="Hide when zoomed out further than"
          onChange={(e) => setLow(Math.min(Number(e.target.value), high))}
          onPointerUp={() => commit(low, high)}
          onKeyUp={() => commit(low, high)}
        />
        <input
          type="range"
          min={lo}
          max={hi}
          step={STEP}
          value={high}
          aria-label="Hide when zoomed in further than"
          onChange={(e) => setHigh(Math.max(Number(e.target.value), low))}
          onPointerUp={() => commit(low, high)}
          onKeyUp={() => commit(low, high)}
        />
      </div>
      <div className="mt-1 flex gap-1 text-[10px]">
        <button
          type="button"
          onClick={() => {
            const next = Math.min(now, high);
            setLow(next);
            commit(next, high);
          }}
          className="rounded border border-line px-1.5 py-0.5 text-fg-muted hover:text-fg"
          title="Hide this marker whenever the map is zoomed out further than it is right now"
        >
          Hide when zoomed out from here
        </button>
        <button
          type="button"
          onClick={() => {
            setLow(lo);
            setHigh(hi);
            commit(lo, hi);
          }}
          className="ml-auto rounded border border-line px-1.5 py-0.5 text-fg-muted hover:text-fg"
        >
          Always
        </button>
      </div>
    </div>
  );
}
