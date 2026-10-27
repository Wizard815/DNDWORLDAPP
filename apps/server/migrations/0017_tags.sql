-- Tags become labels, not pages (docs/DESIGN-connections-2026-10-27.md §1).
--
-- Until now a `#tag` created a page of kind 'tag' and node_tags pointed at it.
-- A tag is now its own row: a name (lowercase, '/' for nesting — "npc/villain"
-- is a child of "npc"), a color from a fixed palette, a description, and an
-- explicit parent. node_tags gains a `source`: 'text' rows are re-derived from
-- the body's #tags on every save, 'manual' rows come from the chip editor /
-- API and survive edits to the prose.
--
-- Existing tag pages: their id becomes the tag's id (nothing that stored the
-- id breaks), their body becomes the description, and the page itself goes to
-- the trash as a plain document (purged in 30 days like any trashed page).

CREATE TABLE tags (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  color         TEXT,
  description   TEXT NOT NULL DEFAULT '',
  parent_tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX tags_world_name_idx ON tags (world_id, name);
CREATE INDEX tags_parent_idx ON tags (parent_tag_id);

INSERT OR IGNORE INTO tags (id, world_id, name, color, description, parent_tag_id, created_at, updated_at)
  SELECT id, world_id, lower(trim(title)), NULL, body_md, NULL, created_at, updated_at
  FROM nodes WHERE kind = 'tag';

CREATE TABLE node_tags_new (
  node_id TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  source  TEXT NOT NULL DEFAULT 'text',
  PRIMARY KEY (node_id, tag_id)
);
INSERT OR IGNORE INTO node_tags_new (node_id, tag_id, source)
  SELECT node_id, tag_node_id, 'text' FROM node_tags
  WHERE tag_node_id IN (SELECT id FROM tags);
DROP TABLE node_tags;
ALTER TABLE node_tags_new RENAME TO node_tags;
CREATE INDEX node_tags_tag_idx ON node_tags (tag_id);

UPDATE nodes
SET kind = 'document',
    is_archived = 1,
    deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE kind = 'tag';
