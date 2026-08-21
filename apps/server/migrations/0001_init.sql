-- 0001_init — P0 spine.
-- These SQL files are the source of truth for the database. src/db/schema.ts mirrors
-- them for typed queries; keep the two in step by hand.

CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  is_server_admin INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY, -- sha256 of the cookie token, never the token itself
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE worlds (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  owner_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  settings   TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memberships (
  world_id   TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL, -- owner | dm | player | guest
  created_at INTEGER NOT NULL,
  PRIMARY KEY (world_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE assets (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  sha256     TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  orig_name  TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX assets_world_sha_idx ON assets (world_id, sha256);

CREATE TABLE templates (
  id              TEXT PRIMARY KEY,
  world_id        TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  icon            TEXT,
  field_schema    TEXT NOT NULL DEFAULT '[]',
  default_body_md TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX templates_world_idx ON templates (world_id);

-- The spine. One table for every kind of thing in a world.
-- `parent_id` is unrestricted: anything nests inside anything.
-- `id` is a short opaque id and is what URLs use, so re-parenting never breaks a link.
CREATE TABLE nodes (
  id             TEXT PRIMARY KEY,
  world_id       TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  parent_id      TEXT REFERENCES nodes (id) ON DELETE CASCADE,
  template_id    TEXT REFERENCES templates (id) ON DELETE SET NULL,
  kind           TEXT NOT NULL DEFAULT 'document',
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL,
  body_md        TEXT NOT NULL DEFAULT '',
  icon           TEXT,
  cover_asset_id TEXT REFERENCES assets (id) ON DELETE SET NULL,
  sort_key       TEXT NOT NULL, -- fractional index; siblings never get renumbered
  visibility     TEXT NOT NULL DEFAULT 'members',
  is_archived    INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX nodes_world_parent_idx ON nodes (world_id, parent_id, sort_key);
CREATE UNIQUE INDEX nodes_world_slug_idx ON nodes (world_id, slug);
CREATE INDEX nodes_template_idx ON nodes (template_id);

-- Kanka's entity posts: sections on a node, each with its own visibility.
-- This is how a player-visible location carries a DM-only briefing.
CREATE TABLE posts (
  id         TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  body_md    TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'members',
  sort_key   TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX posts_node_idx ON posts (node_id, sort_key);

-- One row per field so query views (P3) can filter and sort without parsing JSON.
CREATE TABLE fields (
  id         TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'text',
  value_text TEXT,
  value_num  REAL,
  value_ref  TEXT REFERENCES nodes (id) ON DELETE SET NULL,
  sort_key   TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'members'
);
CREATE INDEX fields_node_idx ON fields (node_id, sort_key);
CREATE INDEX fields_key_idx ON fields (key, value_text);

-- Wiki links. `dst_node_id` stays NULL for a link to a page that does not exist yet,
-- so unresolved links are a queryable to-do list rather than a dead end.
CREATE TABLE links (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  src_node_id TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  dst_node_id TEXT REFERENCES nodes (id) ON DELETE CASCADE,
  target_text TEXT NOT NULL,
  label       TEXT,
  kind        TEXT NOT NULL DEFAULT 'wikilink',
  created_at  INTEGER NOT NULL
);
CREATE INDEX links_src_idx ON links (src_node_id);
CREATE INDEX links_dst_idx ON links (dst_node_id);
CREATE INDEX links_target_idx ON links (world_id, target_text);

CREATE TABLE node_tags (
  node_id     TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  tag_node_id TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, tag_node_id)
);
CREATE INDEX node_tags_tag_idx ON node_tags (tag_node_id);

-- Standalone FTS index (not external-content) because node ids are text, not rowids.
CREATE VIRTUAL TABLE nodes_fts USING fts5 (
  node_id UNINDEXED,
  world_id UNINDEXED,
  title,
  body,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER nodes_fts_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO nodes_fts (node_id, world_id, title, body)
  VALUES (new.id, new.world_id, new.title, new.body_md);
END;

CREATE TRIGGER nodes_fts_ad AFTER DELETE ON nodes BEGIN
  DELETE FROM nodes_fts WHERE node_id = old.id;
END;

CREATE TRIGGER nodes_fts_au AFTER UPDATE OF title, body_md ON nodes BEGIN
  DELETE FROM nodes_fts WHERE node_id = old.id;
  INSERT INTO nodes_fts (node_id, world_id, title, body)
  VALUES (new.id, new.world_id, new.title, new.body_md);
END;
