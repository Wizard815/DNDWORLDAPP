-- 0012_marker_zoom_range — a marker can show only within a zoom range, so a
-- continent map isn't buried under every village pin until you zoom in.
--
-- Units: log2 of on-screen magnification relative to the map image's own
-- pixels — 0 is 100% (one image pixel per screen pixel), -1 is 50%, 1 is 200%.
-- Not Leaflet zoom levels: those depend on whether a map is tiled (a tiled
-- map's native zoom is its pyramid depth, an untiled one's is 0), so the same
-- number would mean different things on different maps. NULL = no limit on
-- that side. Purely a display filter, never a permission: a hidden-by-zoom
-- marker is still sent to everyone who could see it anyway.

ALTER TABLE map_markers ADD COLUMN min_zoom REAL;
ALTER TABLE map_markers ADD COLUMN max_zoom REAL;
