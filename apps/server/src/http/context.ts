import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRow } from "../db/types.ts";
import { SESSION_COOKIE, createSession, userForToken } from "../auth/session.ts";
import type { Viewer } from "../auth/viewer.ts";
import { cookieSecure } from "../env.ts";
import { forbidden, notFound, unauthorized } from "../lib/errors.ts";
import { getNodeRow } from "../services/nodes.ts";
import { roleFor } from "../services/worlds.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

export function attachUser(request: FastifyRequest): void {
  const token = request.cookies[SESSION_COOKIE];
  request.user = token !== undefined ? userForToken(token) : null;
}

export function requireUser(request: FastifyRequest): UserRow {
  if (request.user === null) throw unauthorized();
  return request.user;
}

/** Viewer context for a world. Throws if the user is not a member of it. */
export function viewerForWorld(request: FastifyRequest, worldId: string): Viewer {
  const user = requireUser(request);
  const role = roleFor(worldId, user.id);
  if (role === null) throw notFound("No such world.");
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

export function assertMember(role: string | null): void {
  if (role === null) throw forbidden();
}
