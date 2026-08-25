import type { CreateMapGroupInput, MapGroupDto, MoveMapGroupInput, UpdateMapGroupInput } from "@dndworldapp/schema";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import type { MapGroupRow } from "../db/types.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { keyAfterAll, keyBetween } from "../lib/sortkey.ts";
import { requireMapNode } from "./maps.ts";

/**
 * Kanka's own MapGroup: a named, colored, orderable category any marker can
 * belong to, nestable via parent_group_id — "Regions" containing
 * "Capital"/"City"/"Town", the way the owner's real Kanka map organizes them.
 * Deliberately separate from P4.5's marker-to-marker parentMarkerId (a
 * token's own party/squad hierarchy): this is pure display organization, has
 * no visibility of its own, and any shape can join one. Gated by the same
 * requireMapNode() edit check as markers — there is no reason a DM/editor who
 * can place markers on a map couldn't also organize them into groups.
 */

const selectGroup = db.prepare("SELECT * FROM map_groups WHERE id = ?");
const selectGroupsForMap = db.prepare("SELECT * FROM map_groups WHERE map_node_id = ? ORDER BY sort_key");
const selectSortKeysForMap = db.prepare("SELECT sort_key FROM map_groups WHERE map_node_id = ?");
const insertGroup = db.prepare(`
  INSERT INTO map_groups (id, map_node_id, parent_group_id, name, color, sort_key, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateGroupStmt = db.prepare(`
  UPDATE map_groups SET name = ?, color = ?, parent_group_id = ?, updated_at = ? WHERE id = ?
`);
const moveGroupStmt = db.prepare("UPDATE map_groups SET sort_key = ? WHERE id = ?");
const deleteGroupStmt = db.prepare("DELETE FROM map_groups WHERE id = ?");

export const selectGroupMapNode = db.prepare("SELECT map_node_id FROM map_groups WHERE id = ?");

function toDto(row: MapGroupRow): MapGroupDto {
  return {
    id: row.id,
    mapNodeId: row.map_node_id,
    parentGroupId: row.parent_group_id,
    name: row.name,
    color: row.color,
    sortKey: row.sort_key,
  };
}

/** Reading groups is a read of the map's node, same as listMarkers()/getMap(). No visibility filter — groups carry none. */
export function listMapGroups(mapNodeId: string, viewer: Viewer): MapGroupDto[] {
  requireMapNode(mapNodeId, viewer);
  return (selectGroupsForMap.all(mapNodeId) as MapGroupRow[]).map(toDto);
}

function requireGroupOnMap(mapNodeId: string, groupId: string): MapGroupRow {
  const group = selectGroup.get(groupId) as MapGroupRow | undefined;
  if (group === undefined || group.map_node_id !== mapNodeId) throw notFound("No such group.");
  return group;
}

/** True if `candidateParentId` is `groupId` itself or already an ancestor of it — same shape as maps.ts's marker wouldCycle(). */
function wouldCycle(groupId: string, candidateParentId: string, byId: Map<string, MapGroupRow>): boolean {
  let currentId: string | null = candidateParentId;
  const visited = new Set<string>();
  while (currentId !== null) {
    if (currentId === groupId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = byId.get(currentId)?.parent_group_id ?? null;
  }
  return false;
}

function groupsById(mapNodeId: string): Map<string, MapGroupRow> {
  const rows = selectGroupsForMap.all(mapNodeId) as MapGroupRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

export function createMapGroup(mapNodeId: string, viewer: Viewer, input: CreateMapGroupInput): MapGroupDto {
  requireMapNode(mapNodeId, viewer);
  if (input.parentGroupId !== null && input.parentGroupId !== undefined) {
    requireGroupOnMap(mapNodeId, input.parentGroupId);
  }
  const keys = (selectSortKeysForMap.all(mapNodeId) as Array<{ sort_key: string }>).map((r) => r.sort_key);
  const id = shortId(12);
  const now = Date.now();
  insertGroup.run(id, mapNodeId, input.parentGroupId ?? null, input.name, input.color ?? null, keyAfterAll(keys), now, now);
  return toDto(selectGroup.get(id) as MapGroupRow);
}

export function updateMapGroup(
  mapNodeId: string,
  groupId: string,
  viewer: Viewer,
  input: UpdateMapGroupInput,
): MapGroupDto {
  requireMapNode(mapNodeId, viewer);
  const existing = requireGroupOnMap(mapNodeId, groupId);

  let parentGroupId = existing.parent_group_id;
  if (input.parentGroupId !== undefined) {
    if (input.parentGroupId === null) {
      parentGroupId = null;
    } else {
      const byId = groupsById(mapNodeId);
      if (!byId.has(input.parentGroupId)) throw badRequest("That parent group is not on this map.");
      if (wouldCycle(groupId, input.parentGroupId, byId)) {
        throw badRequest("A group cannot be its own ancestor.");
      }
      parentGroupId = input.parentGroupId;
    }
  }

  updateGroupStmt.run(
    input.name ?? existing.name,
    input.color !== undefined ? input.color : existing.color,
    parentGroupId,
    Date.now(),
    groupId,
  );
  return toDto(selectGroup.get(groupId) as MapGroupRow);
}

export function moveMapGroup(mapNodeId: string, groupId: string, viewer: Viewer, input: MoveMapGroupInput): void {
  requireMapNode(mapNodeId, viewer);
  requireGroupOnMap(mapNodeId, groupId);

  const neighbourKey = (id: string | null | undefined): string | null => {
    if (id === null || id === undefined) return null;
    const sibling = selectGroup.get(id) as MapGroupRow | undefined;
    if (sibling === undefined || sibling.map_node_id !== mapNodeId) throw badRequest("Unknown neighbouring group.");
    return sibling.sort_key;
  };

  const after = neighbourKey(input.afterId);
  const before = neighbourKey(input.beforeId);
  moveGroupStmt.run(keyBetween(after, before), groupId);
}

/** Deleting a group ungroups its markers and un-nests its child groups (ON DELETE SET NULL) rather than cascading. */
export function deleteMapGroup(mapNodeId: string, groupId: string, viewer: Viewer): void {
  requireMapNode(mapNodeId, viewer);
  requireGroupOnMap(mapNodeId, groupId);
  deleteGroupStmt.run(groupId);
}
