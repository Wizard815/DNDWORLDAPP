import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fogMaskSize, parseMarkerPoints } from "@dndworldapp/schema";
import sharp from "sharp";
import { db } from "../db/index.ts";
import type { MapMarkerRow, MapRow } from "../db/types.ts";
import { paths } from "../env.ts";
import { badRequest } from "../lib/errors.ts";

/**
 * Fog of war (P4.4), modeled on DungeonBoard's paint-to-reveal mask.
 *
 * The DM paints a grayscale mask over the map (white revealed, black hidden;
 * a map with fog on and nothing painted is fully hidden). On top of the paint,
 * any region polygon flagged `revealed` clears the fog inside it — a "room
 * reveal" that doesn't need a brush.
 *
 * Enforced here, server-side, not in the browser: a player never receives the
 * hidden parts of the map. Untiled maps get a pre-darkened copy of the image,
 * tiled maps get each tile darkened on request, and markers whose anchor sits
 * under fog are dropped from their marker list. Owners/DMs see the raw map,
 * except while "viewing as a player".
 *
 * Storage: the painted mask is raw 8-bit bytes, deflated, at fogMaskSize()
 * (a quarter of the image's resolution, capped) in DATA_DIR/fog — raw, not
 * PNG, so the marker filter can read it without an async decode. Rendered
 * player images/tiles are cached under DATA_DIR/fog/cache/<nodeId>/<version>/
 * and thrown away when the version moves on.
 */

const FOG_RGB = { r: 13, g: 14, b: 18 };
/** Blur, in mask pixels, applied to the edge players see — "flat feathered fog". */
const FEATHER_SIGMA = 1.6;
/** A mask byte at or above this counts as revealed for marker hit-testing. */
const REVEALED_THRESHOLD = 128;

const fogDir = paths.fog;
const cacheDir = path.join(fogDir, "cache");

const selectRevealedPolygons = db.prepare(
  "SELECT id, points FROM map_markers WHERE map_node_id = ? AND shape = 'polygon' AND revealed = 1 ORDER BY id",
);
const updateFogStamp = db.prepare("UPDATE maps SET fog_mask_updated_at = ?, updated_at = ? WHERE node_id = ?");

function maskFile(nodeId: string): string {
  return path.join(fogDir, `${nodeId}.mask`);
}

/** The DM's painted mask, raw bytes; all zeros (fully hidden) when nothing was painted or the stored size no longer matches. */
function readPaintedMask(nodeId: string, width: number, height: number): Buffer {
  try {
    const data = zlib.inflateSync(fs.readFileSync(maskFile(nodeId)));
    if (data.length === width * height) return data;
  } catch {
    // Missing or unreadable: treat as never painted.
  }
  return Buffer.alloc(width * height);
}

/**
 * Identifies what players can see right now: the paint's timestamp plus a
 * hash of every revealed region. Anything that changes the fog changes this,
 * which is what busts players' image/tile URLs and the render cache.
 */
export function fogVersion(row: MapRow): string | null {
  if (row.fog_enabled !== 1) return null;
  const regions = selectRevealedPolygons.all(row.node_id) as { id: string; points: string | null }[];
  const hash = crypto.createHash("sha1").update(JSON.stringify(regions)).digest("hex").slice(0, 10);
  return `${row.fog_mask_updated_at ?? 0}-${hash}`;
}

/** Scanline-fills a polygon (given in source-image pixels) as revealed (255) into a mask. */
function fillPolygon(mask: Buffer, width: number, height: number, points: [number, number][], scale: number): void {
  const pts = points.map(([x, y]) => [x * scale, y * scale] as const);
  const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))));
  for (let y = minY; y <= maxY; y += 1) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i += 1) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[(i + 1) % pts.length]!;
      if ((y0 <= cy && y1 > cy) || (y1 <= cy && y0 > cy)) xs.push(x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.round(xs[i]!));
      const to = Math.min(width, Math.round(xs[i + 1]!));
      if (to > from) mask.fill(255, y * width + from, y * width + to);
    }
  }
}

interface EffectiveMask {
  version: string;
  width: number;
  height: number;
  /** Mask pixels per source-image pixel. */
  scale: number;
  data: Buffer;
}
const effectiveCache = new Map<string, EffectiveMask>();

/** Paint ∪ revealed regions, at mask resolution — what a player can actually see. Cached per version. */
export function effectiveMask(row: MapRow, imageWidth: number, imageHeight: number): EffectiveMask | null {
  const version = fogVersion(row);
  if (version === null) return null;
  const cached = effectiveCache.get(row.node_id);
  if (cached !== undefined && cached.version === version) return cached;

  const { width, height, scale } = fogMaskSize(imageWidth, imageHeight);
  const data = Buffer.from(readPaintedMask(row.node_id, width, height));
  for (const region of selectRevealedPolygons.all(row.node_id) as { points: string | null }[]) {
    const points = parseMarkerPoints(region.points);
    if (points !== null && points.length >= 3) fillPolygon(data, width, height, points, scale);
  }
  const mask = { version, width, height, scale, data };
  effectiveCache.set(row.node_id, mask);
  return mask;
}

/** Is this source-image pixel revealed? Off-map counts as hidden. */
function isRevealedAt(mask: EffectiveMask, x: number, y: number): boolean {
  const mx = Math.floor(x * mask.scale);
  const my = Math.floor(y * mask.scale);
  if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) return false;
  return mask.data[my * mask.width + mx]! >= REVEALED_THRESHOLD;
}

/**
 * Whether a player may see this marker under the fog: a revealed region
 * always (it is the reveal), anything else only if its anchor — x/y, which
 * for a polygon/path is its first vertex — is in a revealed area.
 */
export function markerVisibleThroughFog(marker: MapMarkerRow, mask: EffectiveMask): boolean {
  if (marker.shape === "polygon" && marker.revealed === 1) return true;
  return isRevealedAt(mask, marker.x, marker.y);
}

/** The painted mask as a PNG, for the DM's editor. */
export async function paintedMaskPng(nodeId: string, imageWidth: number, imageHeight: number): Promise<Buffer> {
  const { width, height } = fogMaskSize(imageWidth, imageHeight);
  return sharp(readPaintedMask(nodeId, width, height), { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Replaces the painted mask from an uploaded PNG, which must be exactly fogMaskSize() pixels. */
export async function savePaintedMask(nodeId: string, png: Buffer, imageWidth: number, imageHeight: number): Promise<void> {
  const { width, height } = fogMaskSize(imageWidth, imageHeight);
  let decoded: { data: Buffer; info: { width: number; height: number } };
  try {
    decoded = await sharp(png).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw badRequest("The fog mask must be a PNG image.");
  }
  if (decoded.info.width !== width || decoded.info.height !== height) {
    throw badRequest(`The fog mask must be ${width}x${height} pixels for this map.`, { width, height });
  }
  fs.mkdirSync(fogDir, { recursive: true });
  const tmp = `${maskFile(nodeId)}.tmp`;
  fs.writeFileSync(tmp, zlib.deflateSync(decoded.data));
  fs.renameSync(tmp, maskFile(nodeId));
  const now = Date.now();
  updateFogStamp.run(now, now, nodeId);
  clearFogCache(nodeId);
}

/** Throws away every cached render for a map — on a new mask, a new image, or fog switched off. */
export function clearFogCache(nodeId: string): void {
  effectiveCache.delete(nodeId);
  fs.rmSync(path.join(cacheDir, nodeId), { recursive: true, force: true });
}

/** Drops cached renders for any version but the current one, so the cache can't grow without bound. */
function pruneOtherVersions(nodeId: string, version: string): void {
  const dir = path.join(cacheDir, nodeId);
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry !== version) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

/**
 * The feathered fog layer as raw RGBA: fog color, opaque where hidden and
 * clear where revealed. `region` is the part of the mask (in mask pixels,
 * possibly fractional, possibly hanging off the edges) to stretch over an
 * output of `size`; anything off the mask stays fogged.
 */
async function fogLayer(
  mask: EffectiveMask,
  region: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
): Promise<Buffer> {
  const alpha = Buffer.alloc(size.width * size.height, 255);
  const left = Math.max(0, Math.floor(region.left));
  const top = Math.max(0, Math.floor(region.top));
  const right = Math.min(mask.width, Math.ceil(region.left + region.width));
  const bottom = Math.min(mask.height, Math.ceil(region.top + region.height));

  if (right > left && bottom > top) {
    const kx = size.width / region.width;
    const ky = size.height / region.height;
    const outLeft = Math.round((left - region.left) * kx);
    const outTop = Math.round((top - region.top) * ky);
    const outWidth = Math.max(1, Math.min(size.width - outLeft, Math.round((right - left) * kx)));
    const outHeight = Math.max(1, Math.min(size.height - outTop, Math.round((bottom - top) * ky)));
    const revealed = await sharp(mask.data, { raw: { width: mask.width, height: mask.height, channels: 1 } })
      .extract({ left, top, width: right - left, height: bottom - top })
      .blur(FEATHER_SIGMA)
      .resize(outWidth, outHeight, { fit: "fill", kernel: "linear" })
      .extractChannel(0)
      .raw()
      .toBuffer();
    for (let y = 0; y < outHeight; y += 1) {
      for (let x = 0; x < outWidth; x += 1) {
        alpha[(outTop + y) * size.width + outLeft + x] = 255 - revealed[y * outWidth + x]!;
      }
    }
  }

  const rgba = Buffer.alloc(size.width * size.height * 4);
  for (let i = 0; i < alpha.length; i += 1) {
    rgba[i * 4] = FOG_RGB.r;
    rgba[i * 4 + 1] = FOG_RGB.g;
    rgba[i * 4 + 2] = FOG_RGB.b;
    rgba[i * 4 + 3] = alpha[i]!;
  }
  return rgba;
}

/** An untiled map's image with the fog composited in, as players see it. Cached per version; returns the file path. */
export async function foggedImage(row: MapRow, sourcePath: string, imageWidth: number, imageHeight: number): Promise<string> {
  const mask = effectiveMask(row, imageWidth, imageHeight)!;
  const dir = path.join(cacheDir, row.node_id, mask.version);
  const out = path.join(dir, "image.webp");
  if (fs.existsSync(out)) return out;

  pruneOtherVersions(row.node_id, mask.version);
  const size = { width: imageWidth, height: imageHeight };
  const layer = await fogLayer(mask, { left: 0, top: 0, width: mask.width, height: mask.height }, size);
  const buffer = await sharp(sourcePath)
    .composite([{ input: layer, raw: { ...size, channels: 4 } }])
    .webp({ quality: 85 })
    .toBuffer();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out, buffer);
  return out;
}

/**
 * One tile of a tiled map, fogged. Tile (z, row, col) of sharp's google
 * layout covers a square of 256·2^(maxZoom−z) source pixels starting at
 * (col, row) times that size — the same math the client's TileLayer uses.
 * `blend: "atop"` keeps the fog off the tile's transparent padding.
 */
export async function foggedTile(
  row: MapRow,
  tilePath: string,
  coords: { z: number; row: number; col: number },
  imageWidth: number,
  imageHeight: number,
): Promise<Buffer> {
  const mask = effectiveMask(row, imageWidth, imageHeight)!;
  const dir = path.join(cacheDir, row.node_id, mask.version, String(coords.z), String(coords.row));
  const out = path.join(dir, `${coords.col}.webp`);
  if (fs.existsSync(out)) return fs.readFileSync(out);

  pruneOtherVersions(row.node_id, mask.version);
  // Mask pixels per tile pixel at this zoom. Read the tile's real size rather
  // than assume 256, in case the tiler ever emits a smaller edge tile.
  const perPixel = 2 ** (row.max_zoom - coords.z) * mask.scale;
  const meta = await sharp(tilePath).metadata();
  const size = { width: meta.width ?? 256, height: meta.height ?? 256 };
  const layer = await fogLayer(
    mask,
    { left: coords.col * 256 * perPixel, top: coords.row * 256 * perPixel, width: size.width * perPixel, height: size.height * perPixel },
    size,
  );
  const buffer = await sharp(tilePath)
    .ensureAlpha()
    .composite([{ input: layer, raw: { ...size, channels: 4 }, blend: "atop" }])
    .webp({ quality: 82 })
    .toBuffer();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(out, buffer);
  return buffer;
}
