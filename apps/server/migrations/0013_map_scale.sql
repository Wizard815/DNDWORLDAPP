-- 0013_map_scale — a map's distance scale, for the measuring tool: how many
-- source-image pixels make one unit, and what the unit is called ("mi", "km",
-- "ft", "days"). Set by calibrating against a known distance on the map.
-- Both NULL = uncalibrated; the measuring tool then reports image pixels.
-- Kept when the source image is replaced: re-uploading the same map at a
-- different resolution needs a recalibration, and the UI says so.

ALTER TABLE maps ADD COLUMN scale_px_per_unit REAL;
ALTER TABLE maps ADD COLUMN scale_unit TEXT;
