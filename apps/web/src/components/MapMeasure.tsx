import { useEffect, useRef, useState } from "react";
import { CircleMarker, Polyline, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { MapDto, MarkerPoint } from "@dndworldapp/schema";
import { latLngToPixel, pixelToLatLng } from "../lib/mapCoords.ts";

/**
 * The measuring tool. Everything here is local to the viewer — nothing is
 * saved except the map's scale, which only someone who can edit the map sets
 * (by calibrating against a line of known length). Uncalibrated, it measures
 * in source-image pixels, which is still enough to compare two distances.
 *
 * Two ways to measure: click point to point (each click adds a leg), or
 * switch to freehand and drag a route — the map stops panning while freehand
 * is on, since a drag can't be both.
 */

export type MeasureMode = "points" | "freehand";

/** Freehand samples closer together than this (in screen pixels) are dropped — a drag fires mousemove far more often than a route needs. */
const FREEHAND_MIN_STEP_PX = 4;
const MEASURE_COLOR = "#f0b429";

export function pathLengthPx(points: MarkerPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  return total;
}

export function formatDistance(px: number, scale: MapDto["scale"]): string {
  if (scale === null) return `${Math.round(px).toLocaleString()} px`;
  const value = px / scale.pxPerUnit;
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} ${scale.unit}`;
}

/** Inside the MapContainer: captures clicks/drags and draws the route with a running total at its end. */
export function MeasureLayer({
  points,
  mode,
  mapScale,
  pixelScale,
  onChange,
}: {
  points: MarkerPoint[];
  mode: MeasureMode;
  mapScale: MapDto["scale"];
  /** MapView's pixel↔LatLng scale (see scaleFor) — not the distance scale. */
  pixelScale: number;
  onChange: (points: MarkerPoint[]) => void;
}) {
  const map = useMap();
  const [hover, setHover] = useState<MarkerPoint | null>(null);
  const drawing = useRef(false);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  // Freehand needs the drag for itself.
  useEffect(() => {
    if (mode !== "freehand") return;
    map.dragging.disable();
    return () => {
      map.dragging.enable();
    };
  }, [map, mode]);

  const toPixel = (latlng: { lat: number; lng: number }): MarkerPoint => {
    const p = latLngToPixel(latlng.lat, latlng.lng, pixelScale);
    return [p.x, p.y];
  };

  useMapEvents({
    click(e) {
      if (mode !== "points") return;
      onChange([...pointsRef.current, toPixel(e.latlng)]);
    },
    mousedown(e) {
      if (mode !== "freehand") return;
      drawing.current = true;
      onChange([toPixel(e.latlng)]);
    },
    mousemove(e) {
      const here = toPixel(e.latlng);
      if (mode === "freehand" && drawing.current) {
        const last = pointsRef.current.at(-1);
        const step = last === undefined ? Infinity : map.latLngToContainerPoint(e.latlng).distanceTo(
          map.latLngToContainerPoint(pixelToLatLng(last[0], last[1], pixelScale)),
        );
        if (step >= FREEHAND_MIN_STEP_PX) onChange([...pointsRef.current, here]);
        return;
      }
      setHover(mode === "points" && pointsRef.current.length > 0 ? here : null);
    },
    mouseup() {
      drawing.current = false;
    },
    mouseout() {
      setHover(null);
    },
  });

  if (points.length === 0) return null;
  const latlngs = points.map(([x, y]) => pixelToLatLng(x, y, pixelScale));
  const last = points.at(-1)!;
  const preview = hover !== null ? [...points, hover] : points;

  return (
    <>
      <Polyline
        positions={latlngs}
        pathOptions={{ color: MEASURE_COLOR, weight: 3, opacity: 0.95, interactive: false }}
      />
      {hover !== null && (
        <Polyline
          positions={[pixelToLatLng(last[0], last[1], pixelScale), pixelToLatLng(hover[0], hover[1], pixelScale)]}
          pathOptions={{ color: MEASURE_COLOR, weight: 2, dashArray: "5 5", opacity: 0.8, interactive: false }}
        />
      )}
      {(mode === "points" ? points : [points[0]!, last]).map(([x, y], i) => (
        <CircleMarker
          key={i}
          center={pixelToLatLng(x, y, pixelScale)}
          radius={4}
          pathOptions={{ color: MEASURE_COLOR, weight: 2, fillColor: "#15161a", fillOpacity: 1, interactive: false }}
        />
      ))}
      <CircleMarker
        center={pixelToLatLng((hover ?? last)[0], (hover ?? last)[1], pixelScale)}
        radius={0}
        pathOptions={{ opacity: 0, interactive: false }}
      >
        <Tooltip permanent direction="right" offset={[8, 0]} className="measure-tooltip">
          {formatDistance(pathLengthPx(preview), mapScale)}
        </Tooltip>
      </CircleMarker>
    </>
  );
}

/** Outside the MapContainer: the readout, mode switch, undo/clear, and (with edit rights) calibration. */
export function MeasurePanel({
  points,
  mode,
  mapScale,
  canCalibrate,
  onModeChange,
  onChange,
  onSaveScale,
  onClose,
}: {
  points: MarkerPoint[];
  mode: MeasureMode;
  mapScale: MapDto["scale"];
  canCalibrate: boolean;
  onModeChange: (mode: MeasureMode) => void;
  onChange: (points: MarkerPoint[]) => void;
  onSaveScale: (scale: MapDto["scale"]) => void;
  onClose: () => void;
}) {
  const [calibrating, setCalibrating] = useState(false);
  const [knownLength, setKnownLength] = useState("");
  const [unit, setUnit] = useState(mapScale?.unit ?? "mi");
  const lengthPx = pathLengthPx(points);

  // Same keys as region drawing: Ctrl/Cmd+Z drops the last point, Escape closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      if (target !== null && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        onChange(points.slice(0, -1));
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [points, onChange, onClose]);

  const known = Number(knownLength);
  const canSave = lengthPx > 0 && Number.isFinite(known) && known > 0 && unit.trim().length > 0;

  return (
    <div className="absolute left-3 top-24 z-[1000] w-64 rounded-md border border-line bg-surface/95 p-3 text-xs text-fg-soft shadow-lg">
      <div className="mb-2 flex items-center">
        <span className="font-medium text-fg-strong">📏 Measure</span>
        <button type="button" onClick={onClose} className="ml-auto text-fg-muted hover:text-fg">
          Close
        </button>
      </div>

      <div className="mb-2 flex gap-1 rounded-md bg-canvas p-0.5" role="tablist">
        {(["points", "freehand"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              onModeChange(m);
              onChange([]);
            }}
            className={`flex-1 rounded px-2 py-1 ${mode === m ? "bg-selected text-fg-strong" : "text-fg-muted hover:text-fg"}`}
          >
            {m === "points" ? "Point to point" : "Freehand"}
          </button>
        ))}
      </div>

      <p className="text-lg font-semibold text-fg-strong">{formatDistance(lengthPx, mapScale)}</p>
      <p className="mb-2 text-[10px] text-fg-muted">
        {points.length === 0
          ? mode === "points"
            ? "Click on the map to start."
            : "Press and drag on the map to trace a route."
          : mode === "points"
            ? `${Math.max(points.length - 1, 0)} leg${points.length === 2 ? "" : "s"} — keep clicking to add more.`
            : "Drag again to start a new route."}
        {mapScale === null && " Not calibrated yet, so this is in image pixels."}
      </p>

      <div className="flex gap-1">
        <button
          type="button"
          disabled={points.length === 0}
          onClick={() => onChange(points.slice(0, -1))}
          className="rounded border border-line px-2 py-0.5 hover:bg-press disabled:opacity-40"
          title="Remove the last point (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={points.length === 0}
          onClick={() => onChange([])}
          className="rounded border border-line px-2 py-0.5 hover:bg-press disabled:opacity-40"
        >
          Clear
        </button>
        {canCalibrate && !calibrating && (
          <button
            type="button"
            onClick={() => setCalibrating(true)}
            className="ml-auto rounded border border-line px-2 py-0.5 hover:bg-press"
            title="Measure something whose real length you know, then enter it here"
          >
            Set scale…
          </button>
        )}
      </div>

      {canCalibrate && calibrating && (
        <form
          className="mt-2 border-t border-divider pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSave) return;
            onSaveScale({ pxPerUnit: lengthPx / known, unit: unit.trim() });
            setCalibrating(false);
            setKnownLength("");
          }}
        >
          <p className="mb-1 text-[10px] text-fg-muted">
            {lengthPx > 0
              ? "The line you just measured is really:"
              : "First measure something whose real length you know — a scale bar, or a road between two towns."}
          </p>
          <div className="flex gap-1">
            <input
              autoFocus
              inputMode="decimal"
              value={knownLength}
              onChange={(e) => setKnownLength(e.target.value)}
              placeholder="e.g. 50"
              aria-label="Real length of the measured line"
              className="w-16 rounded border border-line bg-canvas px-2 py-1 text-fg outline-none focus:border-line-strong"
            />
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="mi"
              aria-label="Unit"
              maxLength={20}
              className="w-16 rounded border border-line bg-canvas px-2 py-1 text-fg outline-none focus:border-line-strong"
            />
            <button
              type="submit"
              disabled={!canSave}
              className="ml-auto rounded bg-accent px-2 text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              Save
            </button>
          </div>
          <button type="button" onClick={() => setCalibrating(false)} className="mt-1 text-[10px] text-fg-muted hover:text-fg">
            Cancel
          </button>
        </form>
      )}

      {mapScale !== null && (
        <p className="mt-2 flex items-center border-t border-divider pt-2 text-[10px] text-fg-muted">
          Scale: 1 {mapScale.unit} = {mapScale.pxPerUnit.toLocaleString(undefined, { maximumFractionDigits: 2 })} px
          {canCalibrate && (
            <button
              type="button"
              onClick={() => onSaveScale(null)}
              className="ml-auto text-fg-muted hover:text-danger"
              title="Forget this map's scale"
            >
              Clear scale
            </button>
          )}
        </p>
      )}
    </div>
  );
}
