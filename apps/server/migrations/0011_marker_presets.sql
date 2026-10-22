-- 0011_marker_presets — reusable marker looks: a named shape + icon + color
-- (+ radius for circles) a DM sets up once and then stamps onto any map in the
-- world. World-scoped, like templates, because "Tavern", "Ruin" or "Enemy camp"
-- mean the same thing on every map of a campaign.
--
-- A preset is a starting point, not a link: placing a marker from one copies
-- its values onto the marker. Editing or deleting a preset later never touches
-- markers already placed with it — the same non-retroactive rule templates
-- follow (HANDOFF §10), for the same reason.

CREATE TABLE marker_presets (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  shape      TEXT NOT NULL DEFAULT 'pin', -- same values as map_markers.shape
  icon       TEXT,
  color      TEXT,
  radius     REAL,                        -- circle presets only
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX marker_presets_world_idx ON marker_presets (world_id);
