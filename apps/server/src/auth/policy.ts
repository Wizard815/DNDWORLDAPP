import type { Role, Visibility } from "@dndworldapp/schema";

/**
 * The single authorization layer. Every read path filters through
 * `visibilitySqlFor`, every write path through `assertCanEdit`. Nothing decides
 * visibility in a route handler, and nothing decides it in the client.
 *
 * P0 implements the role/visibility rules; per-node ACL overrides land in P2 and
 * plug in here, not in the callers.
 */

const LEVELS_BY_ROLE: Record<Role, Visibility[]> = {
  owner: ["public", "members", "dm"],
  dm: ["public", "members", "dm"],
  player: ["public", "members"],
  guest: ["public"],
};

/** Visibility levels a role can read, ignoring `private` (handled per-row). */
export function readableLevels(role: Role | null): Visibility[] {
  if (role === null) return ["public"];
  return LEVELS_BY_ROLE[role];
}

/**
 * SQL fragment plus parameters for "rows this role may read".
 * `private` rows are visible only to their creator, which is why the viewer id
 * is part of the predicate rather than a post-filter.
 */
export function visibilitySqlFor(
  role: Role | null,
  viewerId: string | null,
  column = "visibility",
  creatorColumn = "created_by",
): { sql: string; params: Array<string | null> } {
  const levels = readableLevels(role);
  const placeholders = levels.map(() => "?").join(", ");
  return {
    sql: `(${column} IN (${placeholders}) OR (${column} = 'private' AND ${creatorColumn} IS NOT NULL AND ${creatorColumn} = ?))`,
    params: [...levels, viewerId],
  };
}

export function canRead(
  role: Role | null,
  visibility: Visibility,
  creatorId: string | null,
  viewerId: string | null,
): boolean {
  if (visibility === "private") return viewerId !== null && viewerId === creatorId;
  return readableLevels(role).includes(visibility);
}

/** Owners and DMs edit anything; players edit only what they created. */
export function canEdit(
  role: Role | null,
  creatorId: string | null,
  viewerId: string | null,
): boolean {
  if (role === "owner" || role === "dm") return true;
  if (role === "player") return viewerId !== null && viewerId === creatorId;
  return false;
}

/** Whether a role may create new nodes at all. */
export function canCreate(role: Role | null): boolean {
  return role === "owner" || role === "dm" || role === "player";
}

export function isGameMaster(role: Role | null): boolean {
  return role === "owner" || role === "dm";
}

/**
 * Who may see the content of a `:::secret` block. Deliberately role-gated, not
 * authorship-gated — the same as node/post visibility — so a player who once
 * typed `:::secret` into their own page would not see it back on the next
 * fetch. That is a documented trade-off, not a bug: consistency with the rest
 * of the visibility model wins over that edge case.
 */
export function canSeeSecrets(role: Role | null): boolean {
  return isGameMaster(role);
}

/**
 * Per-node ACL: one-off grants on top of everything above — "this specific
 * person" or "anyone with this role" gets read or edit on one page, beyond
 * what its visibility or ownership would otherwise allow.
 *
 * Deliberately **additive only**, in both directions. A grant can only widen
 * access, never narrow it — there is no "deny" entry, so ACL can never take
 * away what visibility already gives. That sidesteps the precedence question
 * (does a deny beat a role-based allow, or the reverse?) entirely, at the cost
 * of not supporting "everyone except this one player." If that is ever
 * needed, it is a second column here, not a redesign — the callers already
 * compose this as `visibility OR acl`, never as a replacement for it.
 */
export function nodeAclSql(
  nodeIdColumn: string,
  role: Role | null,
  viewerId: string | null,
  mode: "read" | "edit" = "read",
): { sql: string; params: [string | null, Role | null] } {
  const column = mode === "read" ? "can_read" : "can_edit";
  return {
    sql: `EXISTS (SELECT 1 FROM acl a WHERE a.node_id = ${nodeIdColumn} AND a.${column} = 1 AND ((a.subject_type = 'user' AND a.subject_id = ?) OR (a.subject_type = 'role' AND a.subject_id = ?)))`,
    params: [viewerId, role],
  };
}
