import fs from "node:fs";
import path from "node:path";
import type { CreateMarkerInput, FieldVisibility, MapDto, MapMarkerDto, UpdateMarkerInput } from "@dndworldapp/schema";
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
import { getNodeRow, isNodeVisible, requireVisibleNode } from "./nodes.ts";

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
// A trivial one-line lookup duplicated rather than imported from
// services/mapGroups.ts, which itself imports requireMapNode from here —
// importing back would be circular.
const selectGroupMapNodeForValidation = db.prepare("SELECT map_node_id FROM map_groups WHERE id = ?");
const selectNodeForLabel = db.prepare("SELECT id, title, icon FROM nodes WHERE id = ?");
const insertMarker = db.prepare(`
  INSERT INTO map_markers (
    id, map_node_id, target_node_id, parent_marker_id, group_id, shape, x, y, points,
    label, icon, color, radius, members, visibility, created_by, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateMarkerStmt = db.prepare(`
  UPDATE map_markers SET
    x = ?, y = ?, points = ?, target_node_id = ?, parent_marker_id = ?, group_id = ?, label = ?, icon = ?,
    color = ?, radius = ?, members = ?, revealed = ?, visibility = ?, updated_at = ?
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
 * Replacing a map's image twice in quick succession used to race: the second
 * call's `fs.rmSync(outDir)` ran while the first sharp job was still writing
 * into that same directory, corrupting whichever finished last, and either
 * job's `.then()`/`.catch()` could overwrite the OTHER job's final status
 * with stale results (docs/AUDIT-2026-08-24.md finding 2.4). Fixed by giving
 * each call its own generation number (in-memory only — a lost generation
 * counter across a restart just means the very next tiling call starts a
 * fresh, correctly-numbered generation, which is harmless) and having a job
 * check "am I still the current generation for this node?" before it writes
 * anything to the DB or touches the live tile directory. A stale job's output
 * lands in its own temp directory and is discarded, never rendered into.
 */
const tilingGeneration = new Map<string, number>();

function tempTileDirFor(nodeId: string, generation: number): string {
  return path.join(paths.tiles, `${nodeId}.tmp-${generation}`);
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
  const generation = (tilingGeneration.get(nodeId) ?? 0) + 1;
  tilingGeneration.set(nodeId, generation);
  const isCurrent = (): boolean => tilingGeneration.get(nodeId) === generation;

  updateTilingStatus.run("running", null, Date.now(), nodeId);
  const outDir = tileDirFor(nodeId);
  const tmpDir = tempTileDirFor(nodeId, generation);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  sharp(sourcePath)
    .webp({ quality: 82 })
    .tile({ size: 256, layout: "google", depth: "onetile", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toFile(tmpDir)
    .then(() => {
      if (!isCurrent()) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return;
      }
      const zooms = fs
        .readdirSync(tmpDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
        .map((entry) => Number(entry.name));
      if (zooms.length === 0) throw new Error("Tiling produced no zoom levels.");
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.renameSync(tmpDir, outDir);
      updateZoomRange.run(Math.min(...zooms), Math.max(...zooms), "ready", Date.now(), nodeId);
    })
    .catch((err: unknown) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (!isCurrent()) return;
      updateTilingStatus.run("error", err instanceof Error ? err.message : String(err), Date.now(), nodeId);
    });
}

/**
 * Boot-time recovery: a server restart mid-tile leaves `tiling_status =
 * 'running'` forever (the in-memory generation counter that would have
 * resolved it is gone), and MapView.tsx polls a status that will never
 * advance. Reset those rows to `error` so the existing "🖼 Replace image"
 * flow is the recovery path, instead of a silently stuck spinner.
 */
export function recoverStuckTiling(): void {
  db.prepare(
    `UPDATE maps SET tiling_status = 'error',
                     tiling_error = 'Server restarted while tiling; replace the image to retry.',
                     updated_at = ?
     WHERE tiling_status = 'running'`,
  ).run(Date.now());
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

/**
 * Reading a map is a read of its node — requireVisibleNode throws "not found"
 * (not "forbidden") for a node this viewer cannot see, same as every other
 * read path, so a dm-only map's id, image or dimensions cannot be pulled by
 * anyone who knows the node id but was never granted visibility.
 */
export function getMap(nodeId: string, viewer: Viewer): MapDto | null {
  requireVisibleNode(nodeId, viewer);
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

/**
 * A marker's inherited label/icon only comes from a target node THIS VIEWER
 * can see. Inheritance is the P4.1 default (most markers store no override at
 * all), so without this check every unlabeled pin on an otherwise-visible map
 * would hand out the title and id of whatever it targets, dm-only or not.
 * An invisible target falls back to the marker's own label/icon (or an
 * anonymous pin) exactly as if it had never been linked.
 */
function targetNodeFor(
  targetNodeId: string | null,
  viewer: Viewer,
): { id: string; title: string; icon: string | null } | null {
  if (targetNodeId === null) return null;
  if (!isNodeVisible(targetNodeId, viewer)) return null;
  return (
    (selectNodeForLabel.get(targetNodeId) as { id: string; title: string; icon: string | null } | undefined) ?? null
  );
}

function toMarkerDto(row: MapMarkerRow, viewer: Viewer): MapMarkerDto {
  const targetNode = targetNodeFor(row.target_node_id, viewer);
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
    radius: row.radius,
    members: row.members,
    revealed: row.revealed === 1,
    visibility: row.visibility,
    targetNode,
    parentMarkerId: row.parent_marker_id,
    groupId: row.group_id,
  };
}

const RANK: Record<FieldVisibility, number> = { public: 0, members: 1, dm: 2 };
const RANK_TO_VISIBILITY: FieldVisibility[] = ["public", "members", "dm"];

const selectMarkersForMap = db.prepare("SELECT * FROM map_markers WHERE map_node_id = ?");

/**
 * A `parent_marker_id` chain (P4.5, party/army tokens: a group splitting into
 * sub-groups) makes group visibility dominant, matching Kanka's own
 * `MapGroup` model — a marker belonging to a hidden group stays hidden even
 * if its own visibility says otherwise, so hiding "the party" also hides
 * every member without having to remember to hide each one individually.
 * Returns the MOST restrictive visibility across the marker and every
 * ancestor, walking `byId` (all markers on this map, fetched once by the
 * caller) rather than hitting the database per ancestor. `visited` guards
 * against a cycle in already-stored data even though create/update refuse to
 * create one going forward.
 */
function effectiveVisibility(row: MapMarkerRow, byId: Map<string, MapMarkerRow>): FieldVisibility {
  let rank = RANK[row.visibility];
  let current = row;
  const visited = new Set<string>([row.id]);
  while (current.parent_marker_id !== null) {
    const parent = byId.get(current.parent_marker_id);
    if (parent === undefined || visited.has(parent.id)) break;
    visited.add(parent.id);
    rank = Math.max(rank, RANK[parent.visibility]);
    current = parent;
  }
  return RANK_TO_VISIBILITY[rank]!;
}

function markersById(mapNodeId: string): Map<string, MapMarkerRow> {
  const rows = selectMarkersForMap.all(mapNodeId) as MapMarkerRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Reading markers is a read of the map's node — requireVisibleNode gates it,
 * same reasoning as getMap(). Filtering by *effective* (group-dominant)
 * visibility can't be expressed as a flat SQL WHERE the way a plain column
 * comparison can — it needs the whole map's parent chains — so this fetches
 * every marker on the already-visibility-gated map (never more than that:
 * still scoped to one map_node_id, still behind requireVisibleNode) and
 * filters before any row reaches toMarkerDto() or leaves this function. A
 * hidden marker is computed over, never serialized — the same "never returned
 * to begin with" guarantee rule 6.1 asks for, just computed here instead of
 * in the SQL text itself.
 */
export function listMarkers(mapNodeId: string, viewer: Viewer): MapMarkerDto[] {
  requireVisibleNode(mapNodeId, viewer);
  const levels = new Set(readableLevels(viewer.role).filter((l) => l !== "private"));
  const byId = markersById(mapNodeId);
  return [...byId.values()]
    .filter((row) => levels.has(effectiveVisibility(row, byId)))
    .map((row) => toMarkerDto(row, viewer));
}

/** True if `candidateAncestorId` is `markerId` itself or already an ancestor of it — the cycle `parentMarkerId` must never create. */
function wouldCycle(markerId: string, candidateParentId: string, byId: Map<string, MapMarkerRow>): boolean {
  let currentId: string | null = candidateParentId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (currentId === markerId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = byId.get(currentId)?.parent_marker_id ?? null;
  }
  return false;
}

/** Exported for services/mapGroups.ts — group CRUD uses the same "can edit this map" gate as marker CRUD. */
export function requireMapNode(nodeId: string, viewer: Viewer) {
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
  if (input.groupId !== null && input.groupId !== undefined) {
    const group = selectGroupMapNodeForValidation.get(input.groupId) as { map_node_id: string } | undefined;
    if (group === undefined || group.map_node_id !== mapNodeId) {
      throw badRequest("That group is not on this map.");
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
    input.groupId ?? null,
    input.shape,
    input.x,
    input.y,
    points,
    input.label ?? null,
    input.icon ?? null,
    input.color ?? null,
    input.radius ?? null,
    input.members ?? null,
    input.visibility,
    viewer.userId,
    now,
    now,
  );
  return toMarkerDto(selectMarker.get(id) as MapMarkerRow, viewer);
}

/**
 * Editing a map node does not imply seeing everything on it — a player with edit rights
 * (via ownership or an ACL grant) must not be able to read or destroy a `dm`-visibility
 * marker just by knowing its id, when listMarkers() would have filtered it out for them.
 * Same "hidden means 404" convention as requireVisibleNode. Takes the map node
 * itself (not its id) so a caller that already resolved it via requireMapNode
 * is not paying for the same visibility+edit-ACL check twice.
 */
function requireOwnMarker(mapNode: { id: string }, markerId: string, viewer: Viewer): MapMarkerRow {
  const marker = selectMarker.get(markerId) as MapMarkerRow | undefined;
  if (marker === undefined || marker.map_node_id !== mapNode.id) throw notFound("No such marker.");
  // Effective (group-dominant), not just this marker's own visibility — a
  // members-visible token inside a dm-only group must 404 here exactly like
  // listMarkers() already excludes it from the list, or a viewer with edit
  // rights on the map could read/destroy it just by knowing its id.
  const levels = readableLevels(viewer.role).filter((l) => l !== "private");
  const byId = markersById(mapNode.id);
  if (!levels.includes(effectiveVisibility(marker, byId))) throw notFound("No such marker.");
  return marker;
}

export function updateMarker(
  mapNodeId: string,
  markerId: string,
  viewer: Viewer,
  input: UpdateMarkerInput,
): MapMarkerDto {
  const node = requireMapNode(mapNodeId, viewer);
  const existing = requireOwnMarker(node, markerId, viewer);

  if (input.targetNodeId !== undefined && input.targetNodeId !== null) {
    const target = getNodeRow(input.targetNodeId);
    if (target === null || target.world_id !== node.world_id) {
      throw badRequest("That page does not exist in this world.");
    }
  }

  let parentMarkerId = existing.parent_marker_id;
  if (input.parentMarkerId !== undefined) {
    if (input.parentMarkerId === null) {
      parentMarkerId = null;
    } else {
      const byId = markersById(mapNodeId);
      const parent = byId.get(input.parentMarkerId);
      if (parent === undefined) throw badRequest("That marker to group under is not on this map.");
      if (wouldCycle(markerId, input.parentMarkerId, byId)) {
        throw badRequest("A marker cannot be its own ancestor.");
      }
      parentMarkerId = input.parentMarkerId;
    }
  }

  let groupId = existing.group_id;
  if (input.groupId !== undefined) {
    if (input.groupId === null) {
      groupId = null;
    } else {
      const group = selectGroupMapNodeForValidation.get(input.groupId) as { map_node_id: string } | undefined;
      if (group === undefined || group.map_node_id !== mapNodeId) throw badRequest("That group is not on this map.");
      groupId = input.groupId;
    }
  }

  updateMarkerStmt.run(
    input.x ?? existing.x,
    input.y ?? existing.y,
    validatePointsForUpdate(existing.shape, input.points, existing.points),
    input.targetNodeId !== undefined ? input.targetNodeId : existing.target_node_id,
    parentMarkerId,
    groupId,
    input.label !== undefined ? input.label : existing.label,
    input.icon !== undefined ? input.icon : existing.icon,
    input.color !== undefined ? input.color : existing.color,
    input.radius !== undefined ? input.radius : existing.radius,
    input.members !== undefined ? input.members : existing.members,
    input.revealed !== undefined ? (input.revealed ? 1 : 0) : existing.revealed,
    input.visibility ?? existing.visibility,
    Date.now(),
    markerId,
  );
  return toMarkerDto(selectMarker.get(markerId) as MapMarkerRow, viewer);
}

export function deleteMarker(mapNodeId: string, markerId: string, viewer: Viewer): void {
  const node = requireMapNode(mapNodeId, viewer);
  requireOwnMarker(node, markerId, viewer);
  deleteMarkerStmt.run(markerId);
}
