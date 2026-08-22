-- 0002_api_tokens — scoped bearer tokens for the API, scripts and the MCP server.
--
-- A token acts as its owner: it inherits that user's role in each world. Scopes and
-- an optional world binding only ever NARROW what the user could already do. A token
-- can never grant more than the person holding it has.

CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- NULL means every world the user belongs to. Set it to pin a token to one world,
  -- which is what you want for an MCP server wired to a single campaign.
  world_id     TEXT REFERENCES worlds (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  hash         TEXT NOT NULL, -- sha256 of the token; the plaintext is shown once, never stored
  prefix       TEXT NOT NULL, -- leading characters, so a token is identifiable in a list
  scopes       TEXT NOT NULL, -- space-separated: world:read world:write admin
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at   INTEGER,       -- NULL = no expiry
  revoked_at   INTEGER
);

CREATE UNIQUE INDEX api_tokens_hash_idx ON api_tokens (hash);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id, created_at);
