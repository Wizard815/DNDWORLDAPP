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
