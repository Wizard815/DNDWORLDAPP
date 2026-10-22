import { useEffect, useRef, useState } from "react";
import { CircleMarker, ImageOverlay, useMap, useMapEvents } from "react-leaflet";
import type L from "leaflet";
import { fogMaskSize, parseMarkerPoints, type MapDto, type MapMarkerDto } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { latLngToPixel } from "../lib/mapCoords.ts";

/**
 * The DM's side of fog of war (P4.4) — players never run any of this; the
 * server hands them pre-darkened images and tiles (services/fog.ts).
 *
 * Modeled on DungeonBoard: one mask over the map, hidden by default, painted
 * with a round brush — left button with the Reveal brush clears fog, the Hide
 * brush (or the right button, as a shortcut) puts it back — and every stroke
 * joins its samples with a full-width line so a fast drag leaves no gaps.
 *
 * In the browser the mask is kept "alpha-shaped" on a canvas — fog color,
 * opaque where hidden, transparent where revealed — so painting is a plain
 * draw (source-over to hide, destination-out to reveal) and the same canvas
 * doubles as the DM's translucent overlay. It's converted to and from the
 * server's grayscale PNG (white revealed, black hidden) only on load and save.
 */

export type FogTool = "reveal" | "hide" | "pan";

const FOG_STYLE = "rgb(13, 14, 18)";
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
  const stroke = useRef<{ mode: "reveal" | "hide"; last: [number, number] } | null>(null);
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

  // Painting needs the drag; panning comes back with the Pan tool or the panel closing.
  useEffect(() => {
    if (tool === null || tool === "pan") return;
    leaflet.dragging.disable();
    leaflet.doubleClickZoom.disable();
    return () => {
      leaflet.dragging.enable();
      leaflet.doubleClickZoom.enable();
    };
  }, [leaflet, tool]);

  // Reveal all / Hide all.
  useEffect(() => {
    const fog = fogRef.current;
    if (fillRequest === null || fog === null) return;
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

  const dab = (mode: "reveal" | "hide", from: [number, number], to: [number, number]) => {
    const fog = fogRef.current;
    if (fog === null) return;
    const ctx = fog.getContext("2d")!;
    const r = brushInMask();
    ctx.globalCompositeOperation = mode === "reveal" ? "destination-out" : "source-over";
    ctx.strokeStyle = FOG_STYLE;
    ctx.fillStyle = FOG_STYLE;
    ctx.lineCap = "round";
    ctx.lineWidth = r * 2;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to[0], to[1], r, 0, Math.PI * 2);
    ctx.fill();
    render();
  };

  const painting = tool === "reveal" || tool === "hide";

  useMapEvents({
    mousedown(e) {
      if (!painting) return;
      const button = (e.originalEvent as MouseEvent).button;
      if (button !== 0 && button !== 2) return;
      // Right button paints the opposite of the selected brush, like DungeonBoard.
      const mode = button === 2 ? (tool === "reveal" ? "hide" : "reveal") : tool;
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
      {painting && cursor !== null && (
        <CircleMarker
          center={cursor}
          radius={brushPx}
          pathOptions={{ color: tool === "reveal" ? "#f0b429" : "#8b6cf0", weight: 1.5, fill: false, interactive: false }}
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
  saveState,
  onToggleFog,
  onToolChange,
  onBrushChange,
  onFill,
  onClose,
}: {
  map: MapDto;
  tool: FogTool;
  brushPx: number;
  saveState: string | null;
  onToggleFog: (enabled: boolean) => void;
  onToolChange: (tool: FogTool) => void;
  onBrushChange: (px: number) => void;
  onFill: (fill: "reveal" | "hide") => void;
  onClose: () => void;
}) {
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
          <div className="mb-2 flex gap-1 rounded-md bg-canvas p-0.5" role="tablist">
            {(["reveal", "hide", "pan"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tool === t}
                onClick={() => onToolChange(t)}
                className={`flex-1 rounded px-2 py-1 ${tool === t ? "bg-selected text-fg-strong" : "text-fg-muted hover:text-fg"}`}
              >
                {t === "reveal" ? "Reveal" : t === "hide" ? "Hide" : "Pan"}
              </button>
            ))}
          </div>
          <label className="mb-2 block text-[10px] uppercase tracking-wide text-fg-muted">
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
          <p className="mb-2 text-[10px] text-fg-muted">
            Drag on the map to paint. The right mouse button paints the opposite brush. Regions marked “Reveals the
            fog” in their inspector clear it without painting.
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onFill("reveal")}
              className="rounded border border-line px-2 py-0.5 hover:bg-press"
            >
              Reveal all
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Hide the whole map from players again?")) onFill("hide");
              }}
              className="rounded border border-line px-2 py-0.5 hover:bg-press"
            >
              Hide all
            </button>
            <span className="ml-auto self-center text-[10px] text-fg-faint" aria-live="polite">
              {saveState ?? ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
