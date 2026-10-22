-- Two ways to remove a page, both recoverable, with different lifetimes:
--   Archive  — is_archived = 1, deleted_at NULL. Kept until someone restores it.
--   Trash    — is_archived = 1, deleted_at = when. Purged for good 30 days later
--              (services/nodes.ts purgeTrash, run at boot and daily).
-- Trash sets is_archived too, so every existing "is_archived = 0" filter keeps
-- hiding trashed pages without a second predicate everywhere.

ALTER TABLE nodes ADD COLUMN deleted_at INTEGER;
CREATE INDEX nodes_deleted_idx ON nodes (deleted_at) WHERE deleted_at IS NOT NULL;
