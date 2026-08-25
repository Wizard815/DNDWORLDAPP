-- 0010_map_groups — Kanka's own MapGroup: a named, colored, orderable category
-- that ANY marker can belong to (not just tokens — a pin, a region, anything),
-- independent of P4.5's parent_marker_id (which is specifically a token's own
-- party/squad hierarchy, per PLAN.md's "self-referential parent link" wording).
-- Groups nest via parent_group_id, same self-referential shape as Kanka's own
-- MapGroup.parent_id, so "Regions" can contain "Capital"/"City"/"Town" the way
-- the owner's real Kanka map already organizes them.
--
-- Deliberately no visibility column: a group is purely organizational (name,
-- color, draw order, membership) — each marker inside one still carries its
-- own existing visibility exactly as before, unaffected by group membership.
-- Show/hide-by-group is a per-viewer display preference, not a permission,
-- and lives client-side (localStorage) for that reason — see MapView.tsx.

CREATE TABLE map_groups (
  id              TEXT PRIMARY KEY,
  map_node_id     TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  parent_group_id TEXT REFERENCES map_groups (id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  color           TEXT,
  sort_key        TEXT NOT NULL, -- fractional index (lib/sortkey.ts) — draw order too:
                                  -- a later sort_key renders on top, so this is
                                  -- also the "height order" the owner asked for.
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX map_groups_map_idx ON map_groups (map_node_id);
CREATE INDEX map_groups_parent_idx ON map_groups (parent_group_id);

ALTER TABLE map_markers ADD COLUMN group_id TEXT REFERENCES map_groups (id) ON DELETE SET NULL;
CREATE INDEX map_markers_group_idx ON map_markers (group_id);
