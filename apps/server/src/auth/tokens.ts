import { createHash, randomBytes } from "node:crypto";
import type { CreateTokenInput, Scope, TokenDto } from "@dndworldapp/schema";
import { db } from "../db/index.ts";
import type { UserRow } from "../db/types.ts";
import { shortId } from "../lib/id.ts";

/**
 * Bearer tokens for the API, scripts and (from P1.3) the MCP server.
 *
 * A token acts as its owner and inherits that user's role per world. Scopes and the
 * optional world binding only narrow that. The plaintext is shown once at creation;
 * the database stores nothing but its sha256, the same as sessions.
 */

export type ApiTokenRow = {
  id: string;
  user_id: string;
  world_id: string | null;
  name: string;
  hash: string;
  prefix: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
};

export interface TokenAuth {
  user: UserRow;
  tokenId: string;
  worldId: string | null;
  scopes: Scope[];
}

const PREFIX = "dwa_";
/** Only rewrite last_used_at when it is this stale, so reads stay reads. */
const LAST_USED_THROTTLE_MS = 60_000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const insertToken = db.prepare(`
  INSERT INTO api_tokens (id, user_id, world_id, name, hash, prefix, scopes, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectByHash = db.prepare(`
  SELECT t.*, u.id AS u_id, u.email, u.name AS u_name, u.password_hash,
         u.is_server_admin, u.created_at AS u_created_at
  FROM api_tokens t JOIN users u ON u.id = t.user_id
  WHERE t.hash = ?
`);
const selectById = db.prepare("SELECT * FROM api_tokens WHERE id = ?");
const selectForUser = db.prepare(
  "SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC",
);
const touchToken = db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?");
const revoke = db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ?");

export function toTokenDto(row: ApiTokenRow): TokenDto {
  return {
    id: row.id,
    name: row.name,
    worldId: row.world_id,
    scopes: row.scopes.split(" ").filter((s) => s.length > 0) as Scope[],
    prefix: row.prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export function createToken(
  userId: string,
  input: CreateTokenInput,
): { row: ApiTokenRow; secret: string } {
  const secret = `${PREFIX}${randomBytes(32).toString("hex")}`;
  const id = shortId(12);
  const expiresAt =
    input.expiresInDays === null || input.expiresInDays === undefined
      ? null
      : Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000;

  insertToken.run(
    id,
    userId,
    input.worldId ?? null,
    input.name,
    hashToken(secret),
    secret.slice(0, PREFIX.length + 6),
    input.scopes.join(" "),
    Date.now(),
    expiresAt,
  );

  return { row: selectById.get(id) as ApiTokenRow, secret };
}

/** Resolve a bearer token. Returns null for unknown, revoked or expired tokens. */
export function authenticateToken(secret: string): TokenAuth | null {
  const joined = selectByHash.get(hashToken(secret)) as
    | (ApiTokenRow & {
        u_id: string;
        email: string;
        u_name: string;
        password_hash: string;
        is_server_admin: number;
        u_created_at: number;
      })
    | undefined;
  if (joined === undefined) return null;

  const now = Date.now();
  if (joined.revoked_at !== null) return null;
  if (joined.expires_at !== null && joined.expires_at <= now) return null;

  if (joined.last_used_at === null || now - joined.last_used_at > LAST_USED_THROTTLE_MS) {
    touchToken.run(now, joined.id);
  }

  return {
    user: {
      id: joined.u_id,
      email: joined.email,
      name: joined.u_name,
      password_hash: joined.password_hash,
      is_server_admin: joined.is_server_admin,
      created_at: joined.u_created_at,
    },
    tokenId: joined.id,
    worldId: joined.world_id,
    scopes: joined.scopes.split(" ").filter((s) => s.length > 0) as Scope[],
  };
}

export function listTokens(userId: string): TokenDto[] {
  return (selectForUser.all(userId) as ApiTokenRow[]).map(toTokenDto);
}

export function revokeTokenForUser(tokenId: string, userId: string): boolean {
  return Number(revoke.run(Date.now(), tokenId, userId).changes) > 0;
}
