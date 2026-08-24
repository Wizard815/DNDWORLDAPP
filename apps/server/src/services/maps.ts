import fs from "node:fs";
import path from "node:path";
import type { CreateMarkerInput, MapDto, MapMarkerDto, UpdateMarkerInput } from "@dndworldapp/schema";
import { formatMarkerPoints, parseMarkerPoints } from "@dndworldapp/schema";
import sharp from "sharp";
import { readableLevels } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import type { MapMarkerRow, MapRow } from "../db/types.ts";
import { paths } from "../env.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { canEditNode } from "./acl.ts";
import { ensureAssetDimensions, filePathFor, getAssetRow, toDto as assetToDto } from "./assets.ts";
import { getNodeRow, requireVisibleNode } from "./nodes.ts";

/**
 * A map node has at most one `Map` row (its source image + pixel bounds) and any
 * number of `MapMarker`s. Markers are one typed table with a `shape` discriminator
 * rather than a table per shape — see packages/schema/src/index.ts's comment. A
 * marker linked to a node (`targetNodeId`) inherits that node's title/icon at read
 * time unless it sets its own override, the same "resolve from the source, don't
 * duplicate" pattern services/fields.ts uses for template-seeded labels.
 */

const selectMap = db.prepare("SELECT * FROM maps WHERE node_id = ?");
const upsertMap = db.prepare(`
  INSERT INTO maps (node_id, asset_id, min_zoom, max_zoom, tiling_status, tiling_error, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'none', NULL, ?, ?)
  ON CONFLICT (node_id) DO UPDATE SET
    asset_id = excluded.asset_id,
    min_zoom = excluded.min_zoom,
    max_zoom = excluded.max_zoom,
    tiling_status = excluded.tiling_status,
    tiling_error = excluded.tiling_error,
    updated_at = excluded.updated_at
`);

const selectMarker = db.prepare("SELECT * FROM map_markers WHERE id = ?");
const selectMarkersForMap = db.prepare("SELECT * FROM map_markers WHERE map_node_id = ?");
const selectNodeForLabel = db.prepare("SELECT id, title, icon FROM nodes WHERE id = ?");
const insertMarker = db.prepare(`
  INSERT INTO map_markers (
    id, map_node_id, target_node_id, parent_marker_id, shape, x, y, points,
    label, icon, color, members, visibility, created_by, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateMarkerStmt = db.prepare(`
  UPDATE map_markers SET
    x = ?, y = ?, points = ?, target_node_id = ?, label = ?, icon = ?, color = ?,
    members = ?, revealed = ?, visibility = ?, updated_at = ?
  WHERE id = ?
`);
const deleteMarkerStmt = db.prepare("DELETE FROM map_markers WHERE id = ?");
const updateTilingStatus = db.prepare("UPDATE maps SET tiling_status = ?, tiling_error = ?, updated_at = ? WHERE node_id = ?");
const updateZoomRange = db.prepare(
  "UPDATE maps SET min_zoom = ?, max_zoom = ?, tiling_status = ?, updated_at = ? WHERE node_id = ?",
);

/** Untiled default: a plain ImageOverlay needs no real zoom pyramid to be constrained by. */
const UNTILED_MIN_ZOOM = 0;
const UNTILED_MAX_ZOOM = 2;

/** Images at or below this on both axes render fine as a single ImageOverlay — tiling them would only add latency for no visible benefit. */
const TILING_THRESHOLD_PX = 2000;

function tileDirFor(nodeId: string): string {
  return path.join(paths.tiles, nodeId);
}

/**
 * Fire-and-forget: deliberately not awaited by callers. Tiles a map's source image into
 * a Leaflet-ready {z}/{x}/{y}.webp pyramid via sharp's `tile({layout:"google"})` — the
 * same libvips dzsave machinery Kanka's `vips dzsave --layout=google` CLI call reaches
 * for, here driven through sharp's JS API instead of a subprocess. No job queue: this is
 * the same "background work, no external infrastructure" precedent apps/server/src/
 * index.ts's session-purge interval already establishes (see docs/PLAN.md §3). Zoom
 * range is read back from whatever directories sharp actually produced ("ask the tool
 * what it produced," Kanka's own approach) rather than computed by formula up front.
 */
function startTiling(nodeId: string, sourcePath: string): void {
  updateTilingStatus.run("running", null, Date.now(), nodeId);
  const outDir = tileDirFor(nodeId);
  fs.rmSync(outDir, { recursive: true, force: true });

  sharp(sourcePath)
    .webp({ quality: 82 })
    .tile({ size: 256, layout: "google", depth: "onetile", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toFile(outDir)
    .then(() => {
      const zooms = fs
        .readdirSync(outDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
        .map((entry) => Number(entry.name));
      if (zooms.length === 0) throw new Error("Tiling produced no zoom levels.");
      updateZoomRange.run(Math.min(...zooms), Math.max(...zooms), "ready", Date.now(), nodeId);
    })
    .catch((err: unknown) => {
      updateTilingStatus.run("error", err instanceof Error ? err.message : String(err), Date.now(), nodeId);
    });
}

function toMapDto(row: MapRow): MapDto {
  const asset = getAssetRow(row.asset_id);
  if (asset === null) throw notFound("This map's source image is missing.");
  return {
    nodeId: row.node_id,
    assetUrl: assetToDto(asset).url,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    minZoom: row.min_zoom,
    maxZoom: row.max_zoom,
    tilingStatus: row.tiling_status,
    fogEnabled: row.fog_enabled === 1,
  };
}

export function getMap(nodeId: string): MapDto | null {
  const row = selectMap.get(nodeId) as MapRow | undefined;
  return row === undefined ? null : toMapDto(row);
}

/**
 * Sets or replaces a map's source image. Backfills the asset's pixel dimensions if
 * needed, and — only for images large enough that tiling actually helps — kicks off
 * tiling in the background without blocking this call. The response returns
 * immediately either way; a caller polls GET .../map to see tilingStatus advance.
 */
export async function setMapImage(nodeId: string, viewer: Viewer, assetId: string): Promise<MapDto> {
  const node = requireMapNode(nodeId, viewer);
  const asset = getAssetRow(assetId);
  if (asset === null || asset.world_id !== node.world_id) throw badRequest("No such image.");
  const { width, height } = await ensureAssetDimensions(assetId);

  const now = Date.now();
  upsertMap.run(nodeId, assetId, UNTILED_MIN_ZOOM, UNTILED_MAX_ZOOM, now, now);

  if (width > TILING_THRESHOLD_PX || height > TILING_THRESHOLD_PX) {
    startTiling(nodeId, filePathFor(asset));
  }

  return toMapDto(selectMap.get(nodeId) as MapRow);
}

function targetNodeFor(targetNodeId: string | null): { id: string; title: string; icon: string | null } | null {
  if (targetNodeId === null) return null;
  // Same no-extra-visibility-check precedent as breadcrumbFor()/refNode in fields.ts:
  // the marker's own visibility, already filtered by the caller, is the gate here.
  return (
    (selectNodeForLabel.get(targetNodeId) as { id: string; title: string; icon: string | null } | undefined) ?? null
  );
}

function toMarkerDto(row: MapMarkerRow): MapMarkerDto {
  const targetNode = targetNodeFor(row.target_node_id);
  return {
    id: row.id,
    mapNodeId: row.map_node_id,
    shape: row.shape,
    x: row.x,
    y: row.y,
    points: row.points,
    label: row.label ?? targetNode?.title ?? null,
    icon: row.icon ?? targetNode?.icon ?? null,
    color: row.color,
    members: row.members,
    revealed: row.revealed === 1,
    visibility: row.visibility,
    targetNode,
    parentMarkerId: row.parent_marker_id,
  };
}

export function listMarkers(mapNodeId: string, viewer: Viewer): MapMarkerDto[] {
  const levels = readableLevels(viewer.role).filter((l) => l !== "private");
  const rows = (selectMarkersForMap.all(mapNodeId) as MapMarkerRow[]).filter((r) =>
    (levels as string[]).includes(r.visibility),
  );
  return rows.map(toMarkerDto);
}

function requireMapNode(nodeId: string, viewer: Viewer) {
  const node = requireVisibleNode(nodeId, viewer);
  if (!canEditNode(node, viewer)) throw forbidden("You cannot edit markers on this page.");
  return node;
}

// ---------------------------------------------------------------------------
// Marker points (P4.3) — the shared parser (packages/schema) already guarantees
// well-formedness by the time input.points reaches here; what remains is
// shape-specific semantics, which live here because `shape` is in scope.
// ---------------------------------------------------------------------------

/**
 * `polygon` needs at least 3 vertices (fewer is not a region) and `path` at
 * least 2; no other shape carries points at all. Returns `null` for a shape that
 * has no points, and the CANONICALIZED string otherwise (re-serialized through
 * formatMarkerPoints so the stored form is always the normalized one the client
 * and MCP parse from — a producer sending "10,20  30,40" with a double space
 * gets the same stored bytes as the draw UI would).
 */
function validateAndNormalizePoints(
  shape: CreateMarkerInput["shape"],
  rawPoints: string | undefined,
): string | null {
  if (shape !== "polygon" && shape !== "path") {
    if (rawPoints !== undefined) throw badRequest(`${shape} markers do not carry points.`);
    return null;
  }
  const points = parseMarkerPoints(rawPoints);
  if (points === null) throw badRequest("points are required for polygon and path markers.");
  const minVertices = shape === "polygon" ? 3 : 2;
  if (points.length < minVertices) {
    throw badRequest(`A ${shape} needs at least ${minVertices} vertices; got ${points.length}.`);
  }
  return formatMarkerPoints(points);
}

/** The same check for a PATCH that omits shape — resolves the shape from the existing marker. */
function validatePointsForUpdate(
  shape: MapMarkerRow["shape"],
  rawPoints: string | undefined,
  existingPoints: string | null,
): string | null {
  if (rawPoints === undefined) return existingPoints;
  return validateAndNormalizePoints(shape, rawPoints);
}

export function createMarker(mapNodeId: string, viewer: Viewer, input: CreateMarkerInput): MapMarkerDto {
  const node = requireMapNode(mapNodeId, viewer);
  if (input.targetNodeId !== null && input.targetNodeId !== undefined) {
    const target = getNodeRow(input.targetNodeId);
    if (target === null || target.world_id !== node.world_id) {
      throw badRequest("That page does not exist in this world.");
    }
  }
  if (input.parentMarkerId !== null && input.parentMarkerId !== undefined) {
    const parent = selectMarker.get(input.parentMarkerId) as MapMarkerRow | undefined;
    if (parent === undefined || parent.map_node_id !== mapNodeId) {
      throw badRequest("That marker to split from is not on this map.");
    }
  }
  const points = validateAndNormalizePoints(input.shape, input.points);

  const id = shortId(12);
  const now = Date.now();
  insertMarker.run(
    id,
    mapNodeId,
    input.targetNodeId ?? null,
    input.parentMarkerId ?? null,
    input.shape,
    input.x,
    input.y,
    points,
    input.label ?? null,
    input.icon ?? null,
    input.color ?? null,
    input.members ?? null,
    input.visibility,
    viewer.userId,
    now,
    now,
  );
  return toMarkerDto(selectMarker.get(id) as MapMarkerRow);
}

/**
 * Editing a map node does not imply seeing everything on it — a player with edit rights
 * (via ownership or an ACL grant) must not be able to read or destroy a `dm`-visibility
 * marker just by knowing its id, when listMarkers() would have filtered it out for them.
 * Same "hidden means 404" convention as requireVisibleNode.
 */
function requireOwnMarker(mapNodeId: string, markerId: string, viewer: Viewer): MapMarkerRow {
  requireMapNode(mapNodeId, viewer);
  const marker = selectMarker.get(markerId) as MapMarkerRow | undefined;
  if (marker === undefined || marker.map_node_id !== mapNodeId) throw notFound("No such marker.");
  if (!readableLevels(viewer.role).includes(marker.visibility)) throw notFound("No such marker.");
  return marker;
}

export function updateMarker(
  mapNodeId: string,
  markerId: string,
  viewer: Viewer,
  input: UpdateMarkerInput,
): MapMarkerDto {
  const node = requireMapNode(mapNodeId, viewer);
  const existing = requireOwnMarker(mapNodeId, markerId, viewer);

  if (input.targetNodeId !== undefined && input.targetNodeId !== null) {
    const target = getNodeRow(input.targetNodeId);
    if (target === null || target.world_id !== node.world_id) {
      throw badRequest("That page does not exist in this world.");
    }
  }

  updateMarkerStmt.run(
    input.x ?? existing.x,
    input.y ?? existing.y,
    validatePointsForUpdate(existing.shape, input.points, existing.points),
    input.targetNodeId !== undefined ? input.targetNodeId : existing.target_node_id,
    input.label !== undefined ? input.label : existing.label,
    input.icon !== undefined ? input.icon : existing.icon,
    input.color !== undefined ? input.color : existing.color,
    input.members !== undefined ? input.members : existing.members,
    input.revealed !== undefined ? (input.revealed ? 1 : 0) : existing.revealed,
    input.visibility ?? existing.visibility,
    Date.now(),
    markerId,
  );
  return toMarkerDto(selectMarker.get(markerId) as MapMarkerRow);
}

export function deleteMarker(mapNodeId: string, markerId: string, viewer: Viewer): void {
  requireOwnMarker(mapNodeId, markerId, viewer);
  deleteMarkerStmt.run(markerId);
}
