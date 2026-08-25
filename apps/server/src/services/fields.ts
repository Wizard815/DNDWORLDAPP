import type { CreateFieldInput, FieldDto, MoveFieldInput, TemplateFieldDef, UpdateFieldInput } from "@dndworldapp/schema";
import { readableLevels } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import type { FieldRow } from "../db/types.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { keyAfterAll, keyBetween } from "../lib/sortkey.ts";
import { canEditNode } from "./acl.ts";
import { getNodeRow, isNodeVisible, requireVisibleNode } from "./nodes.ts";
import { getTemplateRow } from "./templates.ts";

/**
 * Field VALUES on one node — separate from templates.ts for the same reason
 * acl.ts/shareLinks.ts are separate from nodes.ts: a genuinely different
 * permission shape (template CRUD is DM-gated at world scope; field values
 * are canEditNode-gated at node scope, same as a post).
 *
 * Fields have no `created_by` column, so there is no meaningful 'private'
 * level here — visibility is the 3-value subset public/members/dm, filtered
 * with readableLevels() directly rather than visibilitySqlFor() (which
 * needs a creator column to resolve 'private').
 */

const selectField = db.prepare("SELECT * FROM fields WHERE id = ?");
const selectSortKeysForNode = db.prepare("SELECT sort_key FROM fields WHERE node_id = ?");
const selectRefNode = db.prepare("SELECT id, title, icon FROM nodes WHERE id = ?");
const insertFieldStmt = db.prepare(`
  INSERT INTO fields (id, node_id, key, type, value_text, value_num, value_ref, sort_key, visibility)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateFieldStmt = db.prepare(
  "UPDATE fields SET value_text = ?, value_num = ?, value_ref = ?, visibility = ? WHERE id = ?",
);
const deleteFieldStmt = db.prepare("DELETE FROM fields WHERE id = ?");
const moveFieldStmt = db.prepare("UPDATE fields SET sort_key = ? WHERE id = ?");

function fieldVisibleSql(role: Viewer["role"]): { sql: string; params: string[] } {
  const levels = readableLevels(role).filter((l) => l !== "private");
  return { sql: `visibility IN (${levels.map(() => "?").join(", ")})`, params: levels };
}

/** Definitions from the node's own template, if it has one, keyed for O(1) lookup. */
function defsByKey(templateId: string | null): Map<string, TemplateFieldDef> {
  if (templateId === null) return new Map();
  const template = getTemplateRow(templateId);
  if (template === null) return new Map();
  const defs = JSON.parse(template.field_schema) as TemplateFieldDef[];
  return new Map(defs.map((d) => [d.key, d]));
}

function toDto(row: FieldRow, defs: Map<string, TemplateFieldDef>, viewer: Viewer): FieldDto {
  let value: FieldDto["value"] = null;
  if (row.type === "number") value = row.value_num;
  else if (row.type === "checkbox") value = row.value_num === 1;
  else if (row.type === "link") value = row.value_ref;
  else if (row.type !== "section") value = row.value_text;

  let refNode: FieldDto["refNode"] = undefined;
  if (row.type === "link" && row.value_ref !== null) {
    // A `link` field's own visibility gates the FIELD, not its target — the
    // target can be any node in the world, so it needs its own check here
    // (same reasoning as maps.ts's targetNodeFor). An invisible target
    // resolves to null rather than leaking its title/icon.
    refNode = isNodeVisible(row.value_ref, viewer)
      ? ((selectRefNode.get(row.value_ref) as { id: string; title: string; icon: string | null } | undefined) ?? null)
      : null;
  }

  const def = defs.get(row.key);
  return {
    id: row.id,
    nodeId: row.node_id,
    key: row.key,
    type: row.type,
    value,
    refNode,
    label: def?.label ?? row.key,
    options: def?.options ?? null,
    visibility: row.visibility,
    sortKey: row.sort_key,
  };
}

export function listFields(nodeId: string, viewer: Viewer): FieldDto[] {
  const node = requireVisibleNode(nodeId, viewer);
  const vis = fieldVisibleSql(viewer.role);
  const rows = db
    .prepare(`SELECT * FROM fields WHERE node_id = ? AND ${vis.sql} ORDER BY sort_key`)
    .all(nodeId, ...vis.params) as FieldRow[];
  const defs = defsByKey(node.template_id);
  return rows.map((row) => toDto(row, defs, viewer));
}

function requireEditableNode(nodeId: string, viewer: Viewer) {
  const node = requireVisibleNode(nodeId, viewer);
  if (!canEditNode(node, viewer)) throw forbidden("You cannot edit fields on this page.");
  return node;
}

function columnsFor(
  type: FieldRow["type"],
  value: unknown,
  worldId: string,
): [string | null, number | null, string | null] {
  if (type === "number") return [null, value === null || value === undefined ? null : Number(value), null];
  if (type === "checkbox") return [null, value ? 1 : 0, null];
  if (type === "link") {
    if (value === null || value === undefined) return [null, null, null];
    const target = getNodeRow(String(value));
    if (target === null || target.world_id !== worldId) throw badRequest("That page does not exist in this world.");
    return [null, null, String(value)];
  }
  if (type === "section") return [String(value ?? ""), null, null];
  return [value === null || value === undefined ? null : String(value), null, null];
}

export function createField(nodeId: string, viewer: Viewer, input: CreateFieldInput): FieldDto {
  const node = requireEditableNode(nodeId, viewer);
  const keys = (selectSortKeysForNode.all(nodeId) as Array<{ sort_key: string }>).map((r) => r.sort_key);
  const sortKey = keyAfterAll(keys);
  const [valueText, valueNum, valueRef] = columnsFor(input.type, input.value ?? null, node.world_id);

  const id = shortId(12);
  try {
    insertFieldStmt.run(id, nodeId, input.key, input.type, valueText, valueNum, valueRef, sortKey, input.visibility);
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      throw badRequest(`This page already has a field named "${input.key}".`);
    }
    throw err;
  }
  return toDto(selectField.get(id) as FieldRow, defsByKey(node.template_id), viewer);
}

/**
 * Editing a node does not imply seeing everything on it — a player with edit rights
 * (via ownership or an ACL grant) must not be able to read or destroy a `dm`-visibility
 * field just by knowing its id, when listFields() would have filtered it out for them.
 * Same "hidden means 404" convention as requireVisibleNode.
 */
function requireOwnField(nodeId: string, fieldId: string, viewer: Viewer) {
  const node = requireEditableNode(nodeId, viewer);
  const field = selectField.get(fieldId) as FieldRow | undefined;
  if (field === undefined || field.node_id !== nodeId) throw notFound("No such field.");
  if (!readableLevels(viewer.role).includes(field.visibility)) throw notFound("No such field.");
  return { node, field };
}

export function updateField(nodeId: string, fieldId: string, viewer: Viewer, input: UpdateFieldInput): FieldDto {
  const { node, field } = requireOwnField(nodeId, fieldId, viewer);
  const [valueText, valueNum, valueRef] =
    input.value !== undefined ? columnsFor(field.type, input.value, node.world_id) : [field.value_text, field.value_num, field.value_ref];

  updateFieldStmt.run(valueText, valueNum, valueRef, input.visibility ?? field.visibility, fieldId);
  return toDto(selectField.get(fieldId) as FieldRow, defsByKey(node.template_id), viewer);
}

export function deleteField(nodeId: string, fieldId: string, viewer: Viewer): void {
  requireOwnField(nodeId, fieldId, viewer);
  deleteFieldStmt.run(fieldId);
}

export function moveField(nodeId: string, fieldId: string, viewer: Viewer, input: MoveFieldInput): void {
  requireOwnField(nodeId, fieldId, viewer);

  const neighbourKey = (id: string | null | undefined): string | null => {
    if (id === null || id === undefined) return null;
    const sibling = selectField.get(id) as FieldRow | undefined;
    if (sibling === undefined || sibling.node_id !== nodeId) throw badRequest("Unknown neighbouring field.");
    return sibling.sort_key;
  };

  const after = neighbourKey(input.afterId);
  const before = neighbourKey(input.beforeId);
  moveFieldStmt.run(keyBetween(after, before), fieldId);
}
