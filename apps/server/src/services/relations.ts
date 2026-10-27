import type {
  ConnectionsDto,
  CreateRelationInput,
  FieldConnection,
  PageRef,
  RelationDto,
  RelationLabelDto,
  UpdateRelationInput,
} from "@dndworldapp/schema";
import { isGameMaster, readableLevels } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import type { NodeRow, RelationRow } from "../db/types.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { keyAfterAll } from "../lib/sortkey.ts";
import { canEditNode } from "./acl.ts";
import { listFields } from "./fields.ts";
import { listMarkers } from "./maps.ts";
import { getNodeRow, isNodeVisible, readableNodeSql, requireVisibleNode } from "./nodes.ts";

/**
 * Relations (migration 0018, design doc §2) and the Connections panel's data
 * (§3). A viewer sees a relation only when they can read the relation's own
 * visibility AND both pages it joins, and both pages are live (not archived
 * or trashed) — so a DM-only relation, or any relation to a page the viewer
 * can't see, simply isn't there for them. Editing a relation needs edit
 * rights on either of its pages; only an owner/DM can make one DM-only.
 */

const selectRelation = db.prepare("SELECT * FROM relations WHERE id = ?");
const insertRelation = db.prepare(`
  INSERT INTO relations (id, world_id, source_node_id, target_node_id, label, inverse_label, two_way, note,
                         visibility, sort_key, created_by, created_at, updated_at)
  VALUES (@id, @worldId, @source, @target, @label, @inverse, @twoWay, @note, @visibility, @sortKey, @createdBy, @now, @now)
`);
const updateRelationStmt = db.prepare(`
  UPDATE relations SET label = ?, inverse_label = ?, two_way = ?, note = ?, visibility = ?, updated_at = ? WHERE id = ?
`);
const deleteRelationStmt = db.prepare("DELETE FROM relations WHERE id = ?");
const sortKeysFrom = db.prepare("SELECT sort_key FROM relations WHERE source_node_id = ?");
const pageRefStmt = db.prepare("SELECT id, title, icon FROM nodes WHERE id = ?");

function pageRef(nodeId: string): PageRef {
  return pageRefStmt.get(nodeId) as PageRef;
}

/** SQL for "relations this viewer may see", over `relations r` joined to `nodes s` (source) and `nodes t` (target). */
export function visibleRelationsSql(viewer: Viewer): { sql: string; params: Array<string | null> } {
  const levels = readableLevels(viewer.role).filter((l) => l !== "private");
  const src = readableNodeSql("s", viewer);
  const dst = readableNodeSql("t", viewer);
  return {
    sql: `r.visibility IN (${levels.map(() => "?").join(", ")})
          AND s.is_archived = 0 AND t.is_archived = 0 AND ${src.sql} AND ${dst.sql}`,
    params: [...levels, ...src.params, ...dst.params],
  };
}

function canEditRelation(row: RelationRow, viewer: Viewer): boolean {
  const source = getNodeRow(row.source_node_id);
  const target = getNodeRow(row.target_node_id);
  return (source !== null && canEditNode(source, viewer)) || (target !== null && canEditNode(target, viewer));
}

function toDto(row: RelationRow, viewer: Viewer, from?: string): RelationDto {
  const source = pageRef(row.source_node_id);
  const target = pageRef(row.target_node_id);
  const dto: RelationDto = {
    id: row.id,
    source,
    target,
    label: row.label,
    inverseLabel: row.inverse_label,
    twoWay: row.two_way === 1,
    note: row.note,
    visibility: row.visibility,
    canEdit: canEditRelation(row, viewer),
  };
  if (from !== undefined) {
    const out = row.source_node_id === from;
    dto.direction = out ? "out" : "in";
    dto.reading = out || row.two_way === 1 ? row.label : (row.inverse_label ?? row.label);
    dto.other = out ? target : source;
  }
  return dto;
}

/** One relation, if this viewer may see it — 404 otherwise, never 403, so ids can't be probed. */
function requireVisibleRelation(relationId: string, viewer: Viewer): RelationRow {
  const vis = visibleRelationsSql(viewer);
  const row = db
    .prepare(
      `SELECT r.* FROM relations r JOIN nodes s ON s.id = r.source_node_id JOIN nodes t ON t.id = r.target_node_id
       WHERE r.id = ? AND ${vis.sql}`,
    )
    .get(relationId, ...vis.params) as RelationRow | undefined;
  if (row === undefined) throw notFound("No such relation.");
  return row;
}

export function relationWorld(relationId: string): string | null {
  return (selectRelation.get(relationId) as RelationRow | undefined)?.world_id ?? null;
}

export function relationEnds(relationId: string): [string, string] | null {
  const row = selectRelation.get(relationId) as RelationRow | undefined;
  return row === undefined ? null : [row.source_node_id, row.target_node_id];
}

/** Every relation touching a page, both directions, as that page reads them. */
export function listRelationsFor(nodeId: string, viewer: Viewer): RelationDto[] {
  requireVisibleNode(nodeId, viewer);
  const vis = visibleRelationsSql(viewer);
  const rows = db
    .prepare(
      `SELECT r.* FROM relations r JOIN nodes s ON s.id = r.source_node_id JOIN nodes t ON t.id = r.target_node_id
       WHERE (r.source_node_id = ? OR r.target_node_id = ?) AND ${vis.sql}
       ORDER BY CASE WHEN r.source_node_id = ? THEN 0 ELSE 1 END, lower(r.label), r.sort_key`,
    )
    .all(nodeId, nodeId, ...vis.params, nodeId) as RelationRow[];
  return rows.map((row) => toDto(row, viewer, nodeId));
}

function assertVisibilityAllowed(visibility: string, viewer: Viewer): void {
  if (visibility === "dm" && !isGameMaster(viewer.role)) {
    throw forbidden("Only the owner or a DM can make a relation DM-only.");
  }
}

export function createRelation(sourceNodeId: string, viewer: Viewer, input: CreateRelationInput): RelationDto {
  const source = requireVisibleNode(sourceNodeId, viewer);
  if (!canEditNode(source, viewer)) throw forbidden("You cannot add relations to this page.");
  const target: NodeRow | null = getNodeRow(input.targetNodeId);
  // A target the viewer can't see answers exactly like one that doesn't exist.
  if (target === null || target.world_id !== source.world_id || target.is_archived === 1 || !isNodeVisible(target.id, viewer)) {
    throw badRequest("That page does not exist in this world.");
  }
  if (target.id === source.id) throw badRequest("A page can't have a relation to itself.");
  assertVisibilityAllowed(input.visibility, viewer);

  const id = shortId(12);
  insertRelation.run({
    id,
    worldId: source.world_id,
    source: source.id,
    target: target.id,
    label: input.label,
    inverse: input.twoWay ? null : (input.inverseLabel ?? null),
    twoWay: input.twoWay ? 1 : 0,
    note: input.note,
    visibility: input.visibility,
    sortKey: keyAfterAll((sortKeysFrom.all(source.id) as { sort_key: string }[]).map((r) => r.sort_key)),
    createdBy: viewer.userId,
    now: Date.now(),
  });
  return toDto(selectRelation.get(id) as RelationRow, viewer, source.id);
}

export function updateRelation(relationId: string, viewer: Viewer, input: UpdateRelationInput): RelationDto {
  const row = requireVisibleRelation(relationId, viewer);
  if (!canEditRelation(row, viewer)) throw forbidden("You cannot edit this relation.");
  if (input.visibility !== undefined) assertVisibilityAllowed(input.visibility, viewer);
  const twoWay = input.twoWay !== undefined ? input.twoWay : row.two_way === 1;
  const inverse = twoWay ? null : input.inverseLabel !== undefined ? input.inverseLabel : row.inverse_label;
  updateRelationStmt.run(
    input.label ?? row.label,
    inverse,
    twoWay ? 1 : 0,
    input.note ?? row.note,
    input.visibility ?? row.visibility,
    Date.now(),
    relationId,
  );
  return toDto(selectRelation.get(relationId) as RelationRow, viewer, row.source_node_id);
}

export function deleteRelation(relationId: string, viewer: Viewer): void {
  const row = requireVisibleRelation(relationId, viewer);
  if (!canEditRelation(row, viewer)) throw forbidden("You cannot delete this relation.");
  deleteRelationStmt.run(relationId);
}

/**
 * Labels already used in this world, for the label field's autocomplete —
 * counted over visible relations only, so a DM-only relation's label never
 * shows up as a suggestion to a player.
 */
export function relationLabels(worldId: string, viewer: Viewer): RelationLabelDto[] {
  const vis = visibleRelationsSql(viewer);
  const rows = db
    .prepare(
      `SELECT r.label, r.inverse_label, r.two_way FROM relations r
       JOIN nodes s ON s.id = r.source_node_id JOIN nodes t ON t.id = r.target_node_id
       WHERE r.world_id = ? AND ${vis.sql}`,
    )
    .all(worldId, ...vis.params) as { label: string; inverse_label: string | null; two_way: number }[];

  const byLabel = new Map<string, { label: string; count: number; twoWay: number; inverses: Map<string, number> }>();
  for (const row of rows) {
    const key = row.label.toLowerCase();
    const entry = byLabel.get(key) ?? { label: row.label, count: 0, twoWay: 0, inverses: new Map() };
    entry.count += 1;
    entry.twoWay += row.two_way;
    if (row.inverse_label !== null) entry.inverses.set(row.inverse_label, (entry.inverses.get(row.inverse_label) ?? 0) + 1);
    byLabel.set(key, entry);
  }
  return [...byLabel.values()]
    .map((e) => ({
      label: e.label,
      inverseLabel: [...e.inverses.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      twoWay: e.twoWay * 2 > e.count,
      count: e.count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// The Connections panel (design §3)
// ---------------------------------------------------------------------------

const selectInboundLinkFields = db.prepare(
  "SELECT DISTINCT node_id FROM fields WHERE type = 'link' AND value_ref = ?",
);
const selectMarkerMaps = db.prepare(
  "SELECT id, map_node_id FROM map_markers WHERE target_node_id = ?",
);

export function connectionsFor(nodeId: string, viewer: Viewer): ConnectionsDto {
  const node = requireVisibleNode(nodeId, viewer);
  const vis = readableNodeSql("n", viewer);

  // Link-type fields, both ways. listFields applies field visibility and
  // only resolves a target the viewer can see.
  const fieldLinks: FieldConnection[] = [];
  for (const field of listFields(nodeId, viewer)) {
    if (field.type === "link" && field.refNode != null) {
      fieldLinks.push({ fieldId: field.id, label: field.label, direction: "out", other: field.refNode });
    }
  }
  for (const { node_id: sourceId } of selectInboundLinkFields.all(nodeId) as { node_id: string }[]) {
    const source = getNodeRow(sourceId);
    if (source === null || source.is_archived === 1 || !isNodeVisible(sourceId, viewer)) continue;
    for (const field of listFields(sourceId, viewer)) {
      if (field.type === "link" && field.value === nodeId) {
        fieldLinks.push({ fieldId: field.id, label: field.label, direction: "in", other: pageRef(sourceId) });
      }
    }
  }

  const mentionedIn = db
    .prepare(
      `SELECT DISTINCT n.id, n.title, n.icon FROM links l JOIN nodes n ON n.id = l.src_node_id
       WHERE l.dst_node_id = ? AND n.is_archived = 0 AND ${vis.sql} ORDER BY lower(n.title)`,
    )
    .all(nodeId, ...vis.params) as PageRef[];

  // Outbound links come from this page's own (already secret-stripped) index,
  // so a link written inside a block the viewer can't read was never there.
  const linksTo = db
    .prepare(
      `SELECT DISTINCT n.id, n.title, n.icon FROM links l JOIN nodes n ON n.id = l.dst_node_id
       WHERE l.src_node_id = ? AND n.id != ? AND n.is_archived = 0 AND ${vis.sql} ORDER BY lower(n.title)`,
    )
    .all(nodeId, nodeId, ...vis.params) as PageRef[];

  const wanted = db
    .prepare(
      `SELECT target_text AS targetText, COUNT(*) AS count FROM links
       WHERE src_node_id = ? AND dst_node_id IS NULL GROUP BY lower(target_text) ORDER BY lower(target_text)`,
    )
    .all(nodeId) as { targetText: string; count: number }[];

  // "On maps": only maps the viewer can see, and only markers that map would
  // actually send them (marker visibility, and fog — a pin under fog doesn't
  // tell a player which map this place is on).
  const markersByMap = new Map<string, string[]>();
  for (const marker of selectMarkerMaps.all(nodeId) as { id: string; map_node_id: string }[]) {
    markersByMap.set(marker.map_node_id, [...(markersByMap.get(marker.map_node_id) ?? []), marker.id]);
  }
  const onMaps: ConnectionsDto["onMaps"] = [];
  for (const [mapId, markerIds] of markersByMap) {
    const map = getNodeRow(mapId);
    if (map === null || map.is_archived === 1 || !isNodeVisible(mapId, viewer)) continue;
    const sent = new Set(listMarkers(mapId, viewer).map((m) => m.id));
    const count = markerIds.filter((id) => sent.has(id)).length;
    if (count > 0) onMaps.push({ ...pageRef(mapId), markerCount: count });
  }

  return {
    relations: listRelationsFor(node.id, viewer),
    fieldLinks,
    mentionedIn,
    linksTo,
    onMaps,
    wanted,
  };
}
