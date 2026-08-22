-- Anonymous share links: a token-bearing URL that grants read access to one
-- page and its subtree, with no account required — the second guest
-- mechanism from docs/PLAN.md §5 (per-node ACL, migration 0005, is the first:
-- a real account with a one-off grant; this is no account at all).
--
-- Modelled on api_tokens (0002), not on acl: this row identifies a *link*,
-- not a person or a role, so only its sha256 is stored and the plaintext is
-- shown once at creation, exactly like a bearer token.
CREATE TABLE share_links (
  id         TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
  hash       TEXT NOT NULL UNIQUE,
  prefix     TEXT NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX share_links_node_idx ON share_links (node_id);
