-- Pages inherit visibility from their parent unless they say otherwise.
--
-- `visibility` gains a fifth value, 'inherit' (the default for new pages).
-- Every read path needs a concrete level to compare against, so the resolved
-- answer is materialized here and kept current by services/nodes.ts
-- recomputeEffective() on create, visibility change, move and restore:
--   effective_visibility — the first non-inherit level walking up the tree
--                          ('members' if nothing above says otherwise)
--   effective_owner_id   — for 'private': whose private it is (the creator of
--                          the page that set it), so a child inherited into a
--                          private page is private to that same person.
-- Existing pages keep their explicit level, so nothing changes for them.

ALTER TABLE nodes ADD COLUMN effective_visibility TEXT NOT NULL DEFAULT 'members';
ALTER TABLE nodes ADD COLUMN effective_owner_id TEXT;
UPDATE nodes SET effective_visibility = visibility, effective_owner_id = created_by;
CREATE INDEX nodes_effective_vis_idx ON nodes (world_id, effective_visibility);
