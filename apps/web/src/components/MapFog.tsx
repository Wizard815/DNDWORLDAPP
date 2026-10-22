import { useEffect, useRef, useState } from "react";
import { CircleMarker, ImageOverlay, Rectangle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { fogMaskSize, parseMarkerPoints, type MapDto, type MapMarkerDto } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { latLngToPixel } from "../lib/mapCoords.ts";

/**
 * The DM's side of fog of war (P4.4) — players never run any of this; the
 * server hands them pre-darkened images and tiles (services/fog.ts).
 *
 * Modeled on DungeonBoard: one mask over the map, hidden by default, painted
 * with a round brush — Reveal clears fog, Hide puts it back, Dim leaves it at
 * half strength ("explored": players see the area darkened, markers and all);
 * the right button paints Hide (or Reveal, with the Hide brush) as a
 * shortcut — and every stroke joins its samples with a full-width line so a
 * fast drag leaves no gaps.
 *
 * In the browser the mask is kept "alpha-shaped" on a canvas — fog color,
 * opaque where hidden, transparent where revealed — so painting is a plain
 * draw (source-over to hide, destination-out to reveal) and the same canvas
 * doubles as the DM's translucent overlay. It's converted to and from the
 * server's grayscale PNG (white revealed, black hidden) only on load and save.
 */

/** Paint: left button reveals, right button hides. Dim: left dims, right hides. Move: the drag pans the map instead. */
export type FogTool = "paint" | "dim" | "move";
export type FogBrushShape = "round" | "square";
/** Strokes kept for Ctrl+Z — each is a full copy of the mask, which is small (see fogMaskSize). */
const HISTORY_LIMIT = 40;
type PaintMode = "reveal" | "dim" | "hide";

const FOG_STYLE = "rgb(13, 14, 18)";
/** Fog alpha the Dim brush leaves behind — 50%, which the server reads back as mid-gray ("explored"). */
const DIM_ALPHA = 0.5;
/** How opaque hidden areas look to the DM — enough to read as fog, not so much the DM can't see the map under it. */
const DM_OVERLAY_OPACITY = 0.55;
const SAVE_DEBOUNCE_MS = 500;

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Grayscale mask PNG (white revealed) → alpha-shaped fog canvas. */
async function loadMask(nodeId: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const response = await fetch(`/api/v1/nodes/${nodeId}/map/fog`, { credentials: "same-origin" });
  const fog = newCanvas(width, height);
  const ctx = fog.getContext("2d")!;
  if (!response.ok) {
    ctx.fillStyle = FOG_STYLE;
    ctx.fillRect(0, 0, width, height);
    return fog;
  }
  const bitmap = await createImageBitmap(await response.blob());
  const scratch = newCanvas(width, height).getContext("2d")!;
  scratch.drawImage(bitmap, 0, 0, width, height);
  const pixels = scratch.getImageData(0, 0, width, height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const hidden = 255 - d[i]!;
    d[i] = 13;
    d[i + 1] = 14;
    d[i + 2] = 18;
    d[i + 3] = hidden;
  }
  ctx.putImageData(pixels, 0, 0);
  return fog;
}

/** Alpha-shaped fog canvas → grayscale mask PNG, base64, for PUT /map/fog. */
function exportMask(fog: HTMLCanvasElement): string {
  const out = newCanvas(fog.width, fog.height);
  const pixels = fog.getContext("2d")!.getImageData(0, 0, fog.width, fog.height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const revealed = 255 - d[i + 3]!;
    d[i] = revealed;
    d[i + 1] = revealed;
    d[i + 2] = revealed;
    d[i + 3] = 255;
  }
  out.getContext("2d")!.putImageData(pixels, 0, 0);
  return out.toDataURL("image/png");
}

/**
 * Inside the MapContainer, owner/DM only: shows the fog as a translucent
 * tint (with revealed regions cut out, as players will see them) and, when a
 * brush is picked, paints it. Saves each stroke shortly after it ends.
 */
export function FogEditorLayer({
  map,
  markers,
  bounds,
  pixelScale,
  tool,
  brushPx,
  brushShape,
  fillRequest,
  onSaved,
  onSaveError,
}: {
  map: MapDto;
  markers: MapMarkerDto[];
  bounds: L.LatLngBoundsLiteral;
  /** MapView's pixel↔LatLng scale (see scaleFor). */
  pixelScale: number;
  /** null when the Fog panel is closed — overlay only, no painting. */
  tool: FogTool | null;
  /** Brush radius in screen pixels. */
  brushPx: number;
  brushShape: FogBrushShape;
  /** Bumped by the panel's Reveal all / Hide all, with which one. */
  fillRequest: { seq: number; fill: "reveal" | "hide" } | null;
  onSaved: () => void;
  onSaveError: (message: string) => void;
}) {
  const leaflet = useMap();
  const size = fogMaskSize(map.width, map.height);
  const fogRef = useRef<HTMLCanvasElement | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [cursor, setCursor] = useState<L.LatLng | null>(null);
  const stroke = useRef<{ mode: PaintMode; last: [number, number] } | null>(null);
  const history = useRef<{ undo: ImageData[]; redo: ImageData[] }>({ undo: [], redo: [] });
  const saveTimer = useRef<number | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const frame = useRef<number | null>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;

  /** Redraws the DM's overlay: the fog canvas with revealed regions cut out. Throttled to one per animation frame. */
  const render = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const fog = fogRef.current;
      if (fog === null) return;
      const view = newCanvas(fog.width, fog.height);
      const ctx = view.getContext("2d")!;
      ctx.drawImage(fog, 0, 0);
      ctx.globalCompositeOperation = "destination-out";
      for (const marker of markersRef.current) {
        if (marker.shape !== "polygon" || !marker.revealed) continue;
        const points = parseMarkerPoints(marker.points);
        if (points === null || points.length < 3) continue;
        ctx.beginPath();
        points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * size.scale, y * size.scale) : ctx.lineTo(x * size.scale, y * size.scale)));
        ctx.closePath();
        ctx.fill();
      }
      setOverlayUrl(view.toDataURL("image/png"));
    });
  };

  // Load once per map image (a new image can mean a new mask size).
  useEffect(() => {
    let cancelled = false;
    void loadMask(map.nodeId, size.width, size.height).then((fog) => {
      if (cancelled) return;
      fogRef.current = fog;
      render();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.nodeId, map.assetUrl, size.width, size.height]);

  // Revealed regions are part of the overlay, so redraw when markers change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(render, [markers]);

  /** Saves the whole mask; strokes during a save queue one more save after it. */
  const save = () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const fog = fogRef.current;
      if (fog === null) return;
      const run = async () => {
        await saving.current;
        try {
          await api.putFogMask(map.nodeId, exportMask(fog));
          onSaved();
        } catch {
          onSaveError("Couldn't save the fog — your last strokes may not have reached players.");
        }
      };
      saving.current = run();
    }, SAVE_DEBOUNCE_MS);
  };

  // Painting needs the drag; panning comes back with the Move tool or the
  // panel closing. Text selection is off too — a fast drag otherwise
  // highlights the page around the map.
  useEffect(() => {
    if (tool === null || tool === "move") return;
    const el = leaflet.getContainer();
    leaflet.dragging.disable();
    leaflet.doubleClickZoom.disable();
    el.style.userSelect = "none";
    return () => {
      leaflet.dragging.enable();
      leaflet.doubleClickZoom.enable();
      el.style.userSelect = "";
    };
  }, [leaflet, tool]);

  /** Copies the mask before a change, so Ctrl+Z can bring it back; a new change clears the redo stack. */
  const snapshot = () => {
    const fog = fogRef.current;
    if (fog === null) return;
    const h = history.current;
    h.undo.push(fog.getContext("2d")!.getImageData(0, 0, fog.width, fog.height));
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    h.redo = [];
  };
  const restore = (direction: "undo" | "redo") => {
    const fog = fogRef.current;
    if (fog === null) return;
    const h = history.current;
    const from = direction === "undo" ? h.undo : h.redo;
    const to = direction === "undo" ? h.redo : h.undo;
    const state = from.pop();
    if (state === undefined) return;
    const ctx = fog.getContext("2d")!;
    to.push(ctx.getImageData(0, 0, fog.width, fog.height));
    ctx.putImageData(state, 0, 0);
    render();
    save();
  };

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) while the fog panel is open and the
  // focus isn't in a text field.
  useEffect(() => {
    if (tool === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (target !== null && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) restore("undo");
      else if (key === "y" || (key === "z" && e.shiftKey)) restore("redo");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // Reveal all / Hide all.
  useEffect(() => {
    const fog = fogRef.current;
    if (fillRequest === null || fog === null) return;
    snapshot();
    const ctx = fog.getContext("2d")!;
    ctx.globalCompositeOperation = "source-over";
    if (fillRequest.fill === "reveal") ctx.clearRect(0, 0, fog.width, fog.height);
    else {
      ctx.fillStyle = FOG_STYLE;
      ctx.fillRect(0, 0, fog.width, fog.height);
    }
    render();
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillRequest?.seq]);

  const toMask = (latlng: L.LatLng): [number, number] => {
    const p = latLngToPixel(latlng.lat, latlng.lng, pixelScale);
    return [p.x * size.scale, p.y * size.scale];
  };
  /** Brush radius in mask pixels at the current zoom: screen px ÷ (screen px per image px) × mask px per image px. */
  const brushInMask = () => (brushPx / (2 ** leaflet.getZoom() / pixelScale)) * size.scale;

  const dab = (mode: PaintMode, from: [number, number], to: [number, number]) => {
    const fog = fogRef.current;
    if (fog === null) return;
    const ctx = fog.getContext("2d")!;
    const r = brushInMask();
    // One drawing operation per dab, never a line plus a dot: at the Dim
    // brush's 50% alpha the overlap of two would come out darker. A round-
    // capped line already covers both ends; a single click is just a dot.
    const shape = () => {
      if (from[0] === to[0] && from[1] === to[1]) {
        ctx.beginPath();
        if (brushShape === "square") ctx.rect(to[0] - r, to[1] - r, r * 2, r * 2);
        else ctx.arc(to[0], to[1], r, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      // A square brush dragged along a line is the line with square ends;
      // close enough to a true swept square that nobody painting fog minds.
      ctx.lineCap = brushShape === "square" ? "square" : "round";
      ctx.lineJoin = brushShape === "square" ? "miter" : "round";
      ctx.lineWidth = r * 2;
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
      ctx.stroke();
    };
    ctx.strokeStyle = FOG_STYLE;
    ctx.fillStyle = FOG_STYLE;
    // Dim sets the area to exactly half fog whatever was there before: clear
    // it, then lay half-strength fog back down. Overlapping dabs in one stroke
    // repeat the same two steps, so they don't stack darker.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = mode === "hide" ? "source-over" : "destination-out";
    shape();
    if (mode === "dim") {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = DIM_ALPHA;
      shape();
      ctx.globalAlpha = 1;
    }
    render();
  };

  const painting = tool === "paint" || tool === "dim";

  useMapEvents({
    mousedown(e) {
      if (!painting) return;
      const button = (e.originalEvent as MouseEvent).button;
      if (button !== 0 && button !== 2) return;
      e.originalEvent.preventDefault();
      // One brush, two buttons, like DungeonBoard: left reveals (or dims), right hides.
      const mode: PaintMode = button === 2 ? "hide" : tool === "dim" ? "dim" : "reveal";
      snapshot();
      const at = toMask(e.latlng);
      stroke.current = { mode, last: at };
      dab(mode, at, at);
    },
    mousemove(e) {
      if (painting) setCursor(e.latlng);
      if (stroke.current === null) return;
      const at = toMask(e.latlng);
      dab(stroke.current.mode, stroke.current.last, at);
      stroke.current.last = at;
    },
    mouseup() {
      if (stroke.current === null) return;
      stroke.current = null;
      save();
    },
    mouseout() {
      setCursor(null);
      if (stroke.current !== null) {
        stroke.current = null;
        save();
      }
    },
    contextmenu(e) {
      if (painting) e.originalEvent.preventDefault();
    },
  });

  return (
    <>
      {overlayUrl !== null && <ImageOverlay url={overlayUrl} bounds={bounds} opacity={DM_OVERLAY_OPACITY} />}
      {painting && cursor !== null && brushShape === "round" && (
        <CircleMarker
          center={cursor}
          radius={brushPx}
          pathOptions={{
            color: tool === "dim" ? "#9aa0ad" : "#f0b429",
            weight: 1.5,
            dashArray: tool === "dim" ? "4 3" : undefined,
            fill: false,
            interactive: false,
          }}
        />
      )}
      {painting && cursor !== null && brushShape === "square" && (
        <Rectangle
          bounds={(() => {
            const c = leaflet.latLngToContainerPoint(cursor);
            return L.latLngBounds(
              leaflet.containerPointToLatLng([c.x - brushPx, c.y - brushPx]),
              leaflet.containerPointToLatLng([c.x + brushPx, c.y + brushPx]),
            );
          })()}
          pathOptions={{
            color: tool === "dim" ? "#9aa0ad" : "#f0b429",
            weight: 1.5,
            dashArray: tool === "dim" ? "4 3" : undefined,
            fill: false,
            interactive: false,
          }}
        />
      )}
    </>
  );
}

/** Outside the MapContainer: the owner/DM's fog controls. */
export function FogPanel({
  map,
  tool,
  brushPx,
  brushShape,
  saveState,
  onToggleFog,
  onToolChange,
  onBrushChange,
  onBrushShapeChange,
  onFill,
  onClose,
}: {
  map: MapDto;
  tool: FogTool;
  brushPx: number;
  brushShape: FogBrushShape;
  saveState: string | null;
  onToggleFog: (enabled: boolean) => void;
  onToolChange: (tool: FogTool) => void;
  onBrushChange: (px: number) => void;
  onBrushShapeChange: (shape: FogBrushShape) => void;
  onFill: (fill: "reveal" | "hide") => void;
  onClose: () => void;
}) {
  const [confirmHideAll, setConfirmHideAll] = useState(false);
  return (
    <div className="absolute left-3 top-24 z-[1000] w-64 rounded-md border border-line bg-surface/95 p-3 text-xs text-fg-soft shadow-lg">
      <div className="mb-2 flex items-center">
        <span className="font-medium text-fg-strong">🌫 Fog of war</span>
        <button type="button" onClick={onClose} className="ml-auto text-fg-muted hover:text-fg">
          Close
        </button>
      </div>

      <label className="mb-2 flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={map.fogEnabled}
          onChange={(e) => onToggleFog(e.target.checked)}
          className="accent-accent"
        />
        <span className="text-fg">Fog on this map</span>
      </label>

      {!map.fogEnabled ? (
        <p className="text-[11px] text-fg-muted">
          Players see the whole map. Turn fog on to hide everything you haven't revealed — the first time, that's
          all of it.
        </p>
      ) : (
        <>
          <div className="mb-2 flex gap-0.5 rounded-md bg-canvas p-0.5" role="tablist">
            {(["paint", "dim", "move"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tool === t}
                onClick={() => onToolChange(t)}
                title={t === "paint" ? "Left-drag reveals, right-drag hides" : t === "dim" ? "Left-drag dims (explored, not in view), right-drag hides" : "Drag moves the map instead of painting"}
                className={`flex-1 rounded px-2 py-1 ${tool === t ? "bg-selected text-fg-strong" : "text-fg-muted hover:text-fg"}`}
              >
                {t === "paint" ? "Paint" : t === "dim" ? "Dim" : "Move map"}
              </button>
            ))}
          </div>
          <div className="mb-2 flex items-end gap-2">
            <label className="block flex-1 text-[10px] uppercase tracking-wide text-fg-muted">
              Brush size
              <input
                type="range"
                min={6}
                max={150}
                value={brushPx}
                onChange={(e) => onBrushChange(Number(e.target.value))}
                className="mt-1 block w-full accent-accent"
              />
            </label>
            <div className="flex gap-0.5 rounded-md bg-canvas p-0.5" role="radiogroup" aria-label="Brush shape">
              {(["round", "square"] as const).map((shape) => (
                <button
                  key={shape}
                  type="button"
                  role="radio"
                  aria-checked={brushShape === shape}
                  onClick={() => onBrushShapeChange(shape)}
                  title={shape === "round" ? "Round brush" : "Square brush"}
                  className={`rounded px-2 py-1 text-sm leading-none ${brushShape === shape ? "bg-selected text-fg-strong" : "text-fg-muted hover:text-fg"}`}
                >
                  {shape === "round" ? "●" : "■"}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-2 text-[10px] text-fg-muted">
            Left-drag reveals, right-drag hides. Ctrl+Z / Ctrl+Y undo and redo strokes. Regions marked “Reveals the
            fog” clear it without painting.
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onFill("reveal")}
              className="rounded border border-line px-2 py-0.5 hover:bg-press"
            >
              Reveal all
            </button>
            {confirmHideAll ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmHideAll(false);
                    onFill("hide");
                  }}
                  className="rounded border border-danger-line px-2 py-0.5 text-danger hover:bg-press"
                >
                  Hide everything?
                </button>
                <button type="button" onClick={() => setConfirmHideAll(false)} className="rounded px-2 py-0.5 text-fg-muted hover:text-fg">
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmHideAll(true)}
                className="rounded border border-line px-2 py-0.5 hover:bg-press"
              >
                Hide all
              </button>
            )}
            <span className="ml-auto self-center text-[10px] text-fg-faint" aria-live="polite">
              {saveState ?? ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
