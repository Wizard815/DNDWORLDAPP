-- A preset is "the whole look", not just icon and color: who can see the
-- marker and the zoom range it appears in are part of what a DM means by
-- "make another one like that". Same copy-on-place rule as before — see 0011.

ALTER TABLE marker_presets ADD COLUMN visibility TEXT NOT NULL DEFAULT 'members'; -- same values as map_markers.visibility
ALTER TABLE marker_presets ADD COLUMN min_zoom REAL;                               -- same unit as map_markers.min_zoom (0012)
ALTER TABLE marker_presets ADD COLUMN max_zoom REAL;
