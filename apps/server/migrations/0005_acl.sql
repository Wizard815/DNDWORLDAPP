-- 0005_acl — per-node access grants, on top of node visibility.
--
-- Deliberately additive only: a row here can only WIDEN what a viewer may read or
-- edit on this one node, never narrow it. There is no "deny" — see the comment on
-- nodeAclSql() in src/auth/policy.ts for why. Two shapes, both requested directly:
--   subject_type='user', subject_id=<a users.id>   "this specific person"
--   subject_type='role', subject_id=<a role name>  "anyone with this role" — this is
--                                                   how "anyone can edit this page" is
--                                                   expressed, without touching the
--                                                   page's own visibility for everyone
--                                                   else.
-- Scoped to nodes only, not posts — posts already have their own coarse visibility,
-- and nothing has asked for finer-grained post sharing.

CREATE TABLE acl (
  id           TEXT PRIMARY KEY,
  node_id      TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL, -- 'user' | 'role'
  subject_id   TEXT NOT NULL, -- a users.id, or one of owner|dm|player|guest
  can_read     INTEGER NOT NULL DEFAULT 1,
  can_edit     INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE (node_id, subject_type, subject_id)
);
CREATE INDEX acl_node_idx ON acl (node_id);
