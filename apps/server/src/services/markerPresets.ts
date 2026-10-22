import type { CreateMarkerPresetInput, MarkerPresetDto, UpdateMarkerPresetInput } from "@dndworldapp/schema";
import { db } from "../db/index.ts";
import type { MarkerPresetRow } from "../db/types.ts";
import { notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";

/**
 * A world's reusable marker looks. Pure configuration: placing a marker "from
 * a preset" is the client (or MCP tool) copying these values into an ordinary
 * create-marker call, so map_markers has no preset_id and editing or deleting
 * a preset never reaches a marker already on a map. See migration 0011.
 */

const selectPreset = db.prepare("SELECT * FROM marker_presets WHERE id = ?");
const selectPresetsForWorld = db.prepare("SELECT * FROM marker_presets WHERE world_id = ? ORDER BY name COLLATE NOCASE");
const insertPreset = db.prepare(`
  INSERT INTO marker_presets (id, world_id, name, shape, icon, color, radius, visibility, min_zoom, max_zoom, created_at, updated_at)
  VALUES (@id, @worldId, @name, @shape, @icon, @color, @radius, @visibility, @minZoom, @maxZoom, @now, @now)
`);
const updatePresetStmt = db.prepare(`
  UPDATE marker_presets SET name = ?, shape = ?, icon = ?, color = ?, radius = ?, visibility = ?, min_zoom = ?, max_zoom = ?, updated_at = ? WHERE id = ?
`);
const deletePresetStmt = db.prepare("DELETE FROM marker_presets WHERE id = ?");

function toDto(row: MarkerPresetRow): MarkerPresetDto {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    shape: row.shape,
    icon: row.icon,
    color: row.color,
    radius: row.radius,
    visibility: row.visibility,
    minZoom: row.min_zoom,
    maxZoom: row.max_zoom,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Throws 404 if the preset doesn't exist or belongs to another world — same shape as templates. */
function requirePresetInWorld(presetId: string, worldId: string): MarkerPresetRow {
  const row = (selectPreset.get(presetId) as MarkerPresetRow | undefined) ?? null;
  if (row === null || row.world_id !== worldId) throw notFound("No such marker preset.");
  return row;
}

export function listMarkerPresets(worldId: string): MarkerPresetDto[] {
  return (selectPresetsForWorld.all(worldId) as MarkerPresetRow[]).map(toDto);
}

export function createMarkerPreset(worldId: string, input: CreateMarkerPresetInput): MarkerPresetDto {
  const id = shortId(12);
  insertPreset.run({
    id,
    worldId,
    name: input.name,
    shape: input.shape,
    icon: input.icon ?? null,
    color: input.color ?? null,
    radius: input.radius ?? null,
    visibility: input.visibility,
    minZoom: input.minZoom ?? null,
    maxZoom: input.maxZoom ?? null,
    now: Date.now(),
  });
  return toDto(selectPreset.get(id) as MarkerPresetRow);
}

export function updateMarkerPreset(presetId: string, worldId: string, input: UpdateMarkerPresetInput): MarkerPresetDto {
  const existing = requirePresetInWorld(presetId, worldId);
  updatePresetStmt.run(
    input.name ?? existing.name,
    input.shape ?? existing.shape,
    input.icon !== undefined ? input.icon : existing.icon,
    input.color !== undefined ? input.color : existing.color,
    input.radius !== undefined ? input.radius : existing.radius,
    input.visibility ?? existing.visibility,
    input.minZoom !== undefined ? input.minZoom : existing.min_zoom,
    input.maxZoom !== undefined ? input.maxZoom : existing.max_zoom,
    Date.now(),
    presetId,
  );
  return toDto(selectPreset.get(presetId) as MarkerPresetRow);
}

export function deleteMarkerPreset(presetId: string, worldId: string): void {
  requirePresetInWorld(presetId, worldId);
  deletePresetStmt.run(presetId);
}
