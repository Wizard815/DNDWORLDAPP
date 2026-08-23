import type { CreateTemplateInput, TemplateDto, TemplateFieldDef, UpdateTemplateInput } from "@dndworldapp/schema";
import { db } from "../db/index.ts";
import type { TemplateRow } from "../db/types.ts";
import { notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { keyAfterAll } from "../lib/sortkey.ts";

/**
 * A Template is a world-scoped, named, ordered list of field DEFINITIONS.
 * Assigning one to a node instantiates per-node field VALUES in the `fields`
 * table (see assignTemplateFields below) that the DM can then edit freely,
 * including diverging from the template entirely. Editing a template's
 * field_schema later never retroactively touches nodes that already
 * instantiated fields from it — that would silently mutate content on pages
 * nobody asked to change. A DM who wants a new field on existing nodes uses
 * the explicit "re-apply template" action (routes/fields.ts), which is the
 * same instantiation call, just invoked by hand instead of by assignment.
 */

const selectTemplate = db.prepare("SELECT * FROM templates WHERE id = ?");
const selectTemplatesForWorld = db.prepare("SELECT * FROM templates WHERE world_id = ? ORDER BY name");
const insertTemplate = db.prepare(`
  INSERT INTO templates (id, world_id, name, icon, field_schema, default_body_md, created_at, updated_at)
  VALUES (@id, @worldId, @name, @icon, @fieldSchema, @defaultBodyMd, @now, @now)
`);
const updateTemplateStmt = db.prepare(`
  UPDATE templates SET name = ?, icon = ?, field_schema = ?, default_body_md = ?, updated_at = ?
  WHERE id = ?
`);
const deleteTemplateStmt = db.prepare("DELETE FROM templates WHERE id = ?");
const selectFieldKeysAndSort = db.prepare("SELECT key, sort_key FROM fields WHERE node_id = ?");
const insertField = db.prepare(`
  INSERT INTO fields (id, node_id, key, type, value_text, value_num, value_ref, sort_key, visibility)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (node_id, key) DO NOTHING
`);

function toDto(row: TemplateRow): TemplateDto {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    icon: row.icon,
    fieldSchema: JSON.parse(row.field_schema) as TemplateFieldDef[],
    defaultBodyMd: row.default_body_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTemplates(worldId: string): TemplateDto[] {
  return (selectTemplatesForWorld.all(worldId) as TemplateRow[]).map(toDto);
}

export function getTemplateRow(templateId: string): TemplateRow | null {
  return (selectTemplate.get(templateId) as TemplateRow | undefined) ?? null;
}

/** Throws 404 if the template doesn't exist, or belongs to a different world. */
function requireTemplateInWorld(templateId: string, worldId: string): TemplateRow {
  const row = getTemplateRow(templateId);
  if (row === null || row.world_id !== worldId) throw notFound("No such template.");
  return row;
}

/** Called by nodes.ts before it opens its transaction, so a bad templateId fails fast. */
export function assertTemplateInWorld(templateId: string, worldId: string): void {
  requireTemplateInWorld(templateId, worldId);
}

export function createTemplate(worldId: string, input: CreateTemplateInput): TemplateDto {
  const id = shortId(12);
  const now = Date.now();
  insertTemplate.run({
    id,
    worldId,
    name: input.name,
    icon: input.icon ?? null,
    fieldSchema: JSON.stringify(input.fieldSchema),
    defaultBodyMd: input.defaultBodyMd,
    now,
  });
  return toDto(selectTemplate.get(id) as TemplateRow);
}

export function updateTemplate(templateId: string, worldId: string, input: UpdateTemplateInput): TemplateDto {
  const existing = requireTemplateInWorld(templateId, worldId);
  updateTemplateStmt.run(
    input.name ?? existing.name,
    input.icon !== undefined ? input.icon : existing.icon,
    input.fieldSchema !== undefined ? JSON.stringify(input.fieldSchema) : existing.field_schema,
    input.defaultBodyMd ?? existing.default_body_md,
    Date.now(),
    templateId,
  );
  return toDto(selectTemplate.get(templateId) as TemplateRow);
}

/**
 * `nodes.template_id` is `ON DELETE SET NULL`, so every node using this
 * template detaches automatically. Their already-instantiated `fields` rows
 * are untouched — those values belong to the node, not the template.
 */
export function deleteTemplate(templateId: string, worldId: string): void {
  requireTemplateInWorld(templateId, worldId);
  deleteTemplateStmt.run(templateId);
}

/**
 * Copies each field definition the node doesn't already have (by key) as a
 * blank/default `fields` row, in schema order. Idempotent — safe to call on
 * node create, on template re-assignment, and from the explicit "re-apply
 * template" action, since it only ever adds rows for keys not yet present.
 */
export function assignTemplateFields(nodeId: string, worldId: string, templateId: string): void {
  const template = requireTemplateInWorld(templateId, worldId);
  const defs = JSON.parse(template.field_schema) as TemplateFieldDef[];
  if (defs.length === 0) return;

  const existing = selectFieldKeysAndSort.all(nodeId) as Array<{ key: string; sort_key: string }>;
  const existingKeys = new Set(existing.map((r) => r.key));
  const keys = existing.map((r) => r.sort_key);

  for (const def of defs) {
    if (existingKeys.has(def.key)) continue;
    const sortKey = keyAfterAll(keys);
    keys.push(sortKey);
    const [valueText, valueNum] = seedValue(def);
    insertField.run(shortId(12), nodeId, def.key, def.type, valueText, valueNum, null, sortKey, def.visibility);
  }
}

/** Turns a def's optional defaultValue (or, for a section, its heading text) into columns. */
function seedValue(def: TemplateFieldDef): [string | null, number | null] {
  if (def.type === "section") return [def.label, null];
  if (def.defaultValue === undefined || def.defaultValue === null) return [null, null];
  if (def.type === "number") return [null, Number(def.defaultValue)];
  if (def.type === "checkbox") return [null, def.defaultValue ? 1 : 0];
  return [String(def.defaultValue), null];
}
