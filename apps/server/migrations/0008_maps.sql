-- 0008_maps — P4: map nodes get a source image and pixel bounds; markers are one
-- typed table (a `shape` discriminator, not a table per shape) covering point pins,
-- region/zone polygons, and party/army tokens alike. Fog of war and region reveals
-- are additive concerns layered on the same rows, not separate systems. See
-- docs/HANDOFF.md §7.8.

ALTER TABLE assets ADD COLUMN width INTEGER;
ALTER TABLE assets ADD COLUMN height INTEGER;
-- Nullable, lazily backfilled the first time a map needs them (ensureAssetDimensions()
-- in services/assets.ts, via sharp's metadata() reading only the file header — mirrors
-- Kanka's own Image::ensureDimensions()). Not required at upload time, so non-map
-- image uploads (editor inline images) pay no extra cost.

CREATE TABLE map_layers (
  id          TEXT PRIMARY KEY,
  map_node_id TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  asset_id    TEXT NOT NULL REFERENCES assets (id),
  is_overlay  INTEGER NOT NULL DEFAULT 0, -- 0 = alternate base layer, 1 = always-on
                                          -- overlay (Kanka's type_id split)
  opacity     REAL NOT NULL DEFAULT 1,
  sort_key    TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX map_layers_map_idx ON map_layers (map_node_id);
-- P4.6, backlog — table created now (map_markers.layer_id needs it to exist) but no
-- route/UI ships until this is picked back up.

CREATE TABLE maps (
  node_id             TEXT PRIMARY KEY REFERENCES nodes (id) ON DELETE CASCADE,
  asset_id            TEXT NOT NULL REFERENCES assets (id),
  min_zoom            INTEGER NOT NULL DEFAULT 0,
  max_zoom            INTEGER NOT NULL DEFAULT 2,
  tiling_status       TEXT NOT NULL DEFAULT 'none', -- none|pending|running|ready|error — P4.2
  tiling_error        TEXT,
  fog_enabled         INTEGER NOT NULL DEFAULT 0,   -- P4.4
  fog_mask_updated_at INTEGER,                      -- P4.4; null = no freehand paint yet
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
-- One row per map node — node_id IS the primary key, same node-scoped shape as
-- templates/fields. min_zoom/max_zoom default to a range that suits a plain
-- ImageOverlay; P4.2's tiling job overwrites them with the actually-generated
-- pyramid depth, scanned from the output rather than computed by formula (Kanka's
-- "ask the tool what it produced"). asset_id has no ON DELETE clause (blocks
-- deletion): nothing in this app deletes assets today, and a map losing its source
-- image out from under it would be worse than refusing the delete.

CREATE TABLE map_markers (
  id               TEXT PRIMARY KEY,
  map_node_id      TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  layer_id         TEXT REFERENCES map_layers (id) ON DELETE SET NULL,       -- P4.6
  target_node_id   TEXT REFERENCES nodes (id) ON DELETE SET NULL,
  parent_marker_id TEXT REFERENCES map_markers (id) ON DELETE SET NULL,      -- P4.5
  shape            TEXT NOT NULL DEFAULT 'pin', -- pin|label|circle|polygon|path|token
  x                REAL NOT NULL,
  y                REAL NOT NULL,
  points           TEXT,   -- polygon/path only: "x,y x,y ..." in the same pixel space
                            -- as the map (Kanka's custom_shape shape) — P4.3
  label            TEXT,   -- override; falls back to target_node's title at read time
                            -- when unset and target_node_id is set
  icon             TEXT,   -- override; falls back to target_node's icon likewise
  color            TEXT,
  members          TEXT,   -- token only (P4.5): freeform "who's in this group"
  revealed         INTEGER NOT NULL DEFAULT 0, -- polygon fog-gate; ignored unless the
                            -- map has fog_enabled and shape='polygon' — P4.3/P4.4
  visibility       TEXT NOT NULL DEFAULT 'members', -- public|members|dm — same 3-value
                            -- scheme as fields (no creator column to key 'private' off)
  created_by       TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX map_markers_map_idx ON map_markers (map_node_id);
CREATE INDEX map_markers_parent_idx ON map_markers (parent_marker_id);
