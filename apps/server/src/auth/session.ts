import { createHash, randomBytes } from "node:crypto";
import { db } from "../db/index.ts";
import type { UserRow } from "../db/types.ts";
import { longId } from "../lib/id.ts";

export const SESSION_COOKIE = "dwa_session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The cookie carries the token; the database only ever stores its hash. */
function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const insertSession = db.prepare(
  "INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)",
);
const selectUserByToken = db.prepare(`
  SELECT u.* FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.id = ? AND s.expires_at > ?
`);
const deleteSession = db.prepare("DELETE FROM sessions WHERE id = ?");
const deleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

export function createSession(userId: string, userAgent: string | null): {
  token: string;
  expiresAt: number;
} {
  const token = `${longId()}${randomBytes(24).toString("hex")}`;
  const expiresAt = Date.now() + TTL_MS;
  insertSession.run(tokenId(token), userId, Date.now(), expiresAt, userAgent);
  return { token, expiresAt };
}

export function userForToken(token: string): UserRow | null {
  const row = selectUserByToken.get(tokenId(token), Date.now());
  return (row as UserRow | undefined) ?? null;
}

export function destroySession(token: string): void {
  deleteSession.run(tokenId(token));
}

export function purgeExpiredSessions(): number {
  return Number(deleteExpired.run(Date.now()).changes);
}
