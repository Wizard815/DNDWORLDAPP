import type { FastifyInstance } from "fastify";
import {
  createNodeInputSchema,
  createWorldInputSchema,
  roleSchema,
  searchQuerySchema,
} from "@dndworldapp/schema";
import { z } from "zod";
import { canCreate, isGameMaster } from "../auth/policy.ts";
import { badRequest, forbidden } from "../lib/errors.ts";
import { requireUser, viewerForWorld } from "../http/context.ts";
import { storeAsset } from "../services/assets.ts";
import { createNode, getTree, searchNodes, unresolvedLinks } from "../services/nodes.ts";
import {
  addMemberByEmail,
  createWorld,
  listMembers,
  listWorldsForUser,
  removeMember,
} from "../services/worlds.ts";

const addMemberInputSchema = z.object({
  email: z.string().trim().email().max(254),
  role: roleSchema,
});

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface WorldParams {
  worldId: string;
}

export async function worldRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/worlds", async (request) => ({
    worlds: listWorldsForUser(requireUser(request).id),
  }));

  app.post("/api/v1/worlds", async (request) => {
    const user = requireUser(request);
    const input = createWorldInputSchema.parse(request.body);
    const world = createWorld(user.id, input.name);
    return { world: { id: world.id, name: world.name, slug: world.slug, role: "owner" } };
  });

  app.get<{ Params: WorldParams }>("/api/v1/worlds/:worldId/tree", async (request) => {
    const viewer = viewerForWorld(request, request.params.worldId);
    return { nodes: getTree(request.params.worldId, viewer) };
  });

  app.get<{ Params: WorldParams }>("/api/v1/worlds/:worldId/search", async (request) => {
    const viewer = viewerForWorld(request, request.params.worldId);
    const { q, limit } = searchQuerySchema.parse(request.query);
    return { hits: searchNodes(request.params.worldId, viewer, q, limit) };
  });

  /** Wiki links with no destination yet — the world's to-do list. */
  app.get<{ Params: WorldParams }>("/api/v1/worlds/:worldId/unresolved-links", async (request) => {
    viewerForWorld(request, request.params.worldId);
    return { links: unresolvedLinks(request.params.worldId) };
  });

  app.post<{ Params: WorldParams }>("/api/v1/worlds/:worldId/nodes", async (request, reply) => {
    const viewer = viewerForWorld(request, request.params.worldId);
    if (!canCreate(viewer.role)) throw forbidden("Guests cannot create pages.");
    const input = createNodeInputSchema.parse(request.body ?? {});
    const node = createNode(request.params.worldId, viewer, input);
    reply.code(201);
    return { node: { id: node.id, title: node.title, parentId: node.parent_id } };
  });

  app.get<{ Params: WorldParams }>("/api/v1/worlds/:worldId/members", async (request) => {
    viewerForWorld(request, request.params.worldId);
    return { members: listMembers(request.params.worldId) };
  });

  /** Owners and DMs decide who sits at the table. */
  app.post<{ Params: WorldParams }>("/api/v1/worlds/:worldId/members", async (request) => {
    const viewer = viewerForWorld(request, request.params.worldId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can add members.");
    const input = addMemberInputSchema.parse(request.body);
    const member = addMemberByEmail(request.params.worldId, input.email, input.role);
    if (member === null) throw badRequest("No account with that email address yet.");
    return { member };
  });

  app.delete<{ Params: WorldParams & { userId: string } }>(
    "/api/v1/worlds/:worldId/members/:userId",
    async (request) => {
      const viewer = viewerForWorld(request, request.params.worldId);
      if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can remove members.");
      removeMember(request.params.worldId, request.params.userId);
      return { ok: true };
    },
  );

  app.post<{ Params: WorldParams }>("/api/v1/worlds/:worldId/assets", async (request) => {
    const viewer = viewerForWorld(request, request.params.worldId);
    if (!canCreate(viewer.role)) throw forbidden("Guests cannot upload files.");

    const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (file === undefined) throw badRequest("No file in the request.");

    const data = await file.toBuffer();
    const asset = storeAsset(
      request.params.worldId,
      viewer.userId,
      data,
      file.mimetype,
      file.filename,
    );
    return { asset };
  });
}
