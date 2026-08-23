-- One field key per node. Template instantiation ("copy each field def the
-- node doesn't already have, by key") and ad hoc field creation both rely on
-- this to be race-safe via ON CONFLICT DO NOTHING instead of a
-- check-then-insert race. See services/templates.ts::assignTemplateFields.
CREATE UNIQUE INDEX fields_node_key_idx ON fields (node_id, key);
