import type { NodeTag, TagColor, TagDto, UpdateTagInput } from "@dndworldapp/schema";
import { tagNameSchema } from "@dndworldapp/schema";
import { db, transaction } from "../db/index.ts";
import type { NodeRow } from "../db/types.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { stripSecrets } from "../lib/secrets.ts";
import { parseTags, tagKey } from "../lib/tags.ts";

/**
 * Tags as labels (migration 0017, docs/DESIGN-connections-2026-10-27.md §1).
 * A tag's name is its identity within a world: lowercase, `/`-separated for
 * nesting ("npc/villain" is a child of "npc" — and "npc" exists whenever a
 * child does). Page↔tag rows carry where they came from: 'text' rows are
 * re-derived from the body's `#tags` on every save; 'manual' rows come from
 * the chip editor or the API and survive prose edits. A page's tags are the
 * union, de-duplicated by tag.
 *
 * Deliberately no import of nodes.ts here (it imports this module for
 * reindexing); anything that needs a viewer-filtered page list lives there.
 */

export type TagRow = {
  id: string;
  world_id: string;
  name: string;
  color: TagColor | null;
  description: string;
  parent_tag_id: string | null;
  created_at: number;
  updated_at: number;
};

const selectTag = db.prepare("SELECT * FROM tags WHERE id = ?");
const selectTagByName = db.prepare("SELECT * FROM tags WHERE world_id = ? AND name = ?");
const insertTag = db.prepare(
  "INSERT INTO tags (id, world_id, name, color, description, parent_tag_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);
const selectChildren = db.prepare("SELECT * FROM tags WHERE parent_tag_id = ?");
const deleteTextTagsFrom = db.prepare("DELETE FROM node_tags WHERE node_id = ? AND source = 'text'");
const deleteManualTagsFrom = db.prepare("DELETE FROM node_tags WHERE node_id = ? AND source = 'manual'");
// A tag that is both written in the text and set explicitly counts as 'text':
// the text row wins on conflict, so clearing the explicit set never removes a
// tag the body still carries.
const upsertTextTag = db.prepare(
  "INSERT INTO node_tags (node_id, tag_id, source) VALUES (?, ?, 'text') ON CONFLICT (node_id, tag_id) DO UPDATE SET source = 'text'",
);
const insertManualTag = db.prepare("INSERT OR IGNORE INTO node_tags (node_id, tag_id, source) VALUES (?, ?, 'manual')");
const selectTagsFor = db.prepare(`
  SELECT t.id, t.name, t.color, nt.source FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
  WHERE nt.node_id = ? ORDER BY t.name
`);

export function getTagRow(tagId: string): TagRow | null {
  return (selectTag.get(tagId) as TagRow | undefined) ?? null;
}

export function toTagDto(row: TagRow, pageCount = 0): TagDto {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    color: row.color,
    description: row.description,
    parentTagId: row.parent_tag_id,
    pageCount,
  };
}

/** Lowercased, trimmed, validated — the one normal form a tag name has. */
export function normalizeTagName(raw: string): string {
  const parsed = tagNameSchema.safeParse(tagKey(raw));
  if (!parsed.success) throw badRequest(`"${raw}" is not a valid tag name: letters, digits, _ and -, with / for nesting.`);
  return parsed.data;
}

/** The tag, creating it (and any missing ancestors, for "a/b/c") on first use. */
export function findOrCreateTag(worldId: string, rawName: string): TagRow {
  const name = normalizeTagName(rawName);
  const existing = selectTagByName.get(worldId, name) as TagRow | undefined;
  if (existing !== undefined) return existing;

  const slash = name.lastIndexOf("/");
  const parent = slash > 0 ? findOrCreateTag(worldId, name.slice(0, slash)) : null;
  const id = shortId();
  const now = Date.now();
  insertTag.run(id, worldId, name, null, "", parent?.id ?? null, now, now);
  return selectTag.get(id) as TagRow;
}

/** Every tag under `tagId` (not including it), any depth. */
export function descendantTagIds(tagId: string): string[] {
  const out: string[] = [];
  const stack = [tagId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const child of selectChildren.all(id) as TagRow[]) {
      out.push(child.id);
      stack.push(child.id);
    }
  }
  return out;
}

/** Re-derives a page's 'text' tag rows from its body. Manual rows are untouched. */
export function reindexTextTags(row: NodeRow): void {
  deleteTextTagsFrom.run(row.id);
  // Secret-stripped, same reasoning as links: a #tag only inside a :::secret
  // block must not surface as a real association (its presence alone leaks).
  for (const name of parseTags(stripSecrets(row.body_md))) {
    upsertTextTag.run(row.id, findOrCreateTag(row.world_id, name).id);
  }
}

/** Replaces a page's 'manual' tags with exactly these names. Text-derived rows stay. */
export function setManualTags(row: NodeRow, names: string[]): void {
  transaction(() => {
    deleteManualTagsFrom.run(row.id);
    for (const name of names) insertManualTag.run(row.id, findOrCreateTag(row.world_id, name).id);
  });
}

export function tagsFor(nodeId: string): NodeTag[] {
  return (selectTagsFor.all(nodeId) as Array<{ id: string; name: string; color: TagColor | null; source: "text" | "manual" }>).map(
    (r) => ({ id: r.id, name: r.name, color: r.color, source: r.source }),
  );
}

export function createTag(worldId: string, input: { name: string; color?: TagColor | null; description?: string }): TagDto {
  const name = normalizeTagName(input.name);
  if (selectTagByName.get(worldId, name) !== undefined) throw conflict(`A tag named "${name}" already exists.`);
  const row = findOrCreateTag(worldId, name);
  if (input.color !== undefined || input.description !== undefined) {
    db.prepare("UPDATE tags SET color = ?, description = ?, updated_at = ? WHERE id = ?").run(
      input.color ?? null,
      input.description ?? "",
      Date.now(),
      row.id,
    );
  }
  return toTagDto(selectTag.get(row.id) as TagRow);
}

/**
 * Rename (which re-parents by the new name's prefix and renames the whole
 * subtree with it: "npc" → "people" takes "npc/villain" to "people/villain"),
 * recolor, or redescribe.
 */
export function updateTag(tagId: string, input: UpdateTagInput): TagDto {
  const row = getTagRow(tagId);
  if (row === null) throw notFound("No such tag.");
  const now = Date.now();
  transaction(() => {
    if (input.name !== undefined) {
      const name = normalizeTagName(input.name);
      if (name !== row.name) {
        const clash = selectTagByName.get(row.world_id, name) as TagRow | undefined;
        if (clash !== undefined) throw conflict(`A tag named "${name}" already exists — merge into it instead.`);
        if (name.startsWith(`${row.name}/`)) throw badRequest("A tag cannot be moved under itself.");
        const slash = name.lastIndexOf("/");
        const parent = slash > 0 ? findOrCreateTag(row.world_id, name.slice(0, slash)) : null;
        db.prepare("UPDATE tags SET name = ?, parent_tag_id = ?, updated_at = ? WHERE id = ?").run(name, parent?.id ?? null, now, tagId);
        renameSubtree(tagId, row.name, name, now);
      }
    }
    if (input.color !== undefined) db.prepare("UPDATE tags SET color = ?, updated_at = ? WHERE id = ?").run(input.color, now, tagId);
    if (input.description !== undefined) {
      db.prepare("UPDATE tags SET description = ?, updated_at = ? WHERE id = ?").run(input.description, now, tagId);
    }
  });
  return toTagDto(selectTag.get(tagId) as TagRow);
}

function renameSubtree(tagId: string, oldPrefix: string, newPrefix: string, now: number): void {
  for (const child of selectChildren.all(tagId) as TagRow[]) {
    const name = `${newPrefix}${child.name.slice(oldPrefix.length)}`;
    db.prepare("UPDATE tags SET name = ?, updated_at = ? WHERE id = ?").run(name, now, child.id);
    renameSubtree(child.id, child.name, name, now);
  }
}

/** Every page tagged `tagId` becomes tagged `intoTagId`; children move under it; the merged tag is gone. */
export function mergeTag(tagId: string, intoTagId: string): TagDto {
  const from = getTagRow(tagId);
  const into = getTagRow(intoTagId);
  if (from === null || into === null || from.world_id !== into.world_id) throw notFound("No such tag.");
  if (from.id === into.id) throw badRequest("A tag cannot be merged into itself.");
  if (into.name.startsWith(`${from.name}/`)) throw badRequest("A tag cannot be merged into one of its own children.");
  const now = Date.now();
  transaction(() => {
    db.prepare("INSERT OR IGNORE INTO node_tags (node_id, tag_id, source) SELECT node_id, ?, source FROM node_tags WHERE tag_id = ?").run(
      into.id,
      from.id,
    );
    for (const child of selectChildren.all(from.id) as TagRow[]) {
      const name = `${into.name}${child.name.slice(from.name.length)}`;
      const clash = selectTagByName.get(into.world_id, name) as TagRow | undefined;
      if (clash !== undefined) {
        mergeTag(child.id, clash.id);
      } else {
        db.prepare("UPDATE tags SET name = ?, parent_tag_id = ?, updated_at = ? WHERE id = ?").run(name, into.id, now, child.id);
        renameSubtree(child.id, child.name, name, now);
      }
    }
    db.prepare("DELETE FROM tags WHERE id = ?").run(from.id);
  });
  return toTagDto(selectTag.get(into.id) as TagRow);
}

/** Removes the tag and everything nested under it; pages just lose the label. */
export function deleteTag(tagId: string): void {
  if (getTagRow(tagId) === null) throw notFound("No such tag.");
  transaction(() => {
    for (const id of descendantTagIds(tagId)) db.prepare("DELETE FROM tags WHERE id = ?").run(id);
    db.prepare("DELETE FROM tags WHERE id = ?").run(tagId);
  });
}
