-- 0009_marker_radius — circle markers had no stored size at all: MapView.tsx
-- rendered every one with a hardcoded radius={10} screen pixels, so there was
-- no way to make a circle bigger or smaller, and no way it could ever have
-- worked, not a bug in some existing control. Stored in the same pixel space
-- as x/y/points, so a circle's radius scales with the map exactly like a
-- region's vertices already do (see MapView.tsx's `scale`) — a circle drawn
-- to cover a certain amount of the map covers that same amount at any zoom.

ALTER TABLE map_markers ADD COLUMN radius REAL;
-- Nullable: existing circle markers (created before this column existed) fall
-- back to a sane default at read time rather than needing a backfill.
