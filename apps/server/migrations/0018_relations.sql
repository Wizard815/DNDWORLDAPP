-- 0018_relations — typed, directional relations between pages
-- (docs/DESIGN-connections-2026-10-27.md §2), modelled on Kanka's relations.
--
-- One row per relation. `label` is free text ("reports to"), autocompleted
-- from the world's existing labels; `inverse_label` is how the TARGET's page
-- reads the same row ("commands") — a reading, not a second row. `two_way`
-- means one symmetric label shown the same from both ends ("allies").
-- `visibility` is per relation (same public/members/dm scheme as fields and
-- markers): a player sees a relation only if they can read the relation AND
-- both pages it joins. Relations die with either page (hard delete); an
-- archived or trashed page just stops showing them.

CREATE TABLE relations (
  id             TEXT PRIMARY KEY,
  world_id       TEXT NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  inverse_label  TEXT,
  two_way        INTEGER NOT NULL DEFAULT 0,
  note           TEXT NOT NULL DEFAULT '',
  visibility     TEXT NOT NULL DEFAULT 'members',
  sort_key       TEXT NOT NULL,
  created_by     TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX relations_source_idx ON relations (source_node_id);
CREATE INDEX relations_target_idx ON relations (target_node_id);
CREATE INDEX relations_label_idx ON relations (world_id, label);
