import type { FastifyReply, FastifyRequest } from "fastify";
import type { Scope } from "@dndworldapp/schema";
import type { UserRow } from "../db/types.ts";
import { SESSION_COOKIE, createSession, userForToken } from "../auth/session.ts";
import { isGameMaster } from "../auth/policy.ts";
import { authenticateToken } from "../auth/tokens.ts";
import type { TokenAuth } from "../auth/tokens.ts";
import type { Viewer } from "../auth/viewer.ts";
import { cookieSecure } from "../env.ts";
import { forbidden, notFound, unauthorized } from "../lib/errors.ts";
import { getNodeRow } from "../services/nodes.ts";
import { roleFor } from "../services/worlds.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: UserRow | null;
    /** Set only when the request authenticated with a bearer token. */
    tokenAuth: TokenAuth | null;
  }
}

/**
 * Two ways in: the browser's session cookie, or a bearer token for scripts and the
 * MCP server. A cookie carries the user's full rights; a token carries a subset.
 */
export function attachUser(request: FastifyRequest): void {
  request.tokenAuth = null;

  const header = request.headers.authorization;
  if (header !== undefined && header.startsWith("Bearer ")) {
    const auth = authenticateToken(header.slice("Bearer ".length).trim());
    if (auth !== null) {
      request.user = auth.user;
      request.tokenAuth = auth;
      return;
    }
    // A bad bearer token is a failed attempt, not an anonymous request.
    request.user = null;
    return;
  }

  const cookie = request.cookies[SESSION_COOKIE];
  request.user = cookie !== undefined ? userForToken(cookie) : null;
}

/** `admin` implies `world:write`, which implies `world:read`. */
const IMPLIED: Record<Scope, Scope[]> = {
  admin: ["admin", "world:write", "world:read"],
  "world:write": ["world:write", "world:read"],
  "world:read": ["world:read"],
};

export function tokenHasScope(scopes: Scope[], required: Scope): boolean {
  return scopes.some((granted) => IMPLIED[granted].includes(required));
}

/**
 * Scope check for token-authenticated requests. Cookie sessions are unrestricted —
 * they are the user acting directly.
 */
export function assertScope(request: FastifyRequest, required: Scope): void {
  const auth = request.tokenAuth;
  if (auth === null) return;
  if (!tokenHasScope(auth.scopes, required)) {
    throw forbidden(`This token lacks the ${required} scope.`);
  }
}

export function requireUser(request: FastifyRequest): UserRow {
  if (request.user === null) throw unauthorized();
  return request.user;
}

/** Viewer context for a world. Throws if the user is not a member of it. */
export function viewerForWorld(request: FastifyRequest, worldId: string): Viewer {
  const user = requireUser(request);

  // A world-pinned token cannot reach past its world, and says "not found" rather
  // than "forbidden" so it cannot be used to probe which worlds exist.
  const auth = request.tokenAuth;
  if (auth !== null && auth.worldId !== null && auth.worldId !== worldId) {
    throw notFound("No such world.");
  }

  const role = roleFor(worldId, user.id);
  if (role === null) throw notFound("No such world.");

  // "View as a player": an owner/DM previewing their own world exactly as a
  // player would see it. Only ever narrows — a player sending this header
  // stays a player, and it does nothing for anyone who isn't already owner/dm.
  if (request.headers["x-view-as"] === "player" && isGameMaster(role)) {
    return { userId: user.id, role: "player" };
  }

  return { userId: user.id, role };
}

/** Viewer context derived from the node's world, since node URLs are flat. */
export function viewerForNode(
  request: FastifyRequest,
  nodeId: string,
): { viewer: Viewer; worldId: string } {
  const node = getNodeRow(nodeId);
  if (node === null) throw notFound("No such node.");
  const viewer = viewerForWorld(request, node.world_id);
  return { viewer, worldId: node.world_id };
}

export function startSession(request: FastifyRequest, reply: FastifyReply, userId: string): void {
  const { token, expiresAt } = createSession(userId, request.headers["user-agent"] ?? null);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure,
    path: "/",
    expires: new Date(expiresAt),
  });
}
