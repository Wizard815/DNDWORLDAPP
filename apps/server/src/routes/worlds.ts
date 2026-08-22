import type { FastifyInstance } from "fastify";
import {
  addMemberInputSchema,
  createNodeInputSchema,
  createWorldInputSchema,
  resetPasswordInputSchema,
  searchQuerySchema,
} from "@dndworldapp/schema";
import { canCreate, isGameMaster } from "../auth/policy.ts";
import { badRequest, forbidden } from "../lib/errors.ts";
import { requireUser, viewerForWorld } from "../http/context.ts";
import { storeAsset } from "../services/assets.ts";
import { createNode, getTree, searchNodes, unresolvedLinks } from "../services/nodes.ts";
import {
  addOrCreateMember,
  createWorld,
  listMembers,
  listWorldsForUser,
  removeMember,
  resetMemberPassword,
} from "../services/worlds.ts";

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

  /**
   * The DM's member panel: add someone who already has an account, or create a
   * brand-new one for them in the same step. There is no invite email — this
   * app is self-hosted with no mail server, so a human always sets the account
   * up directly, the same way a homelab admin creates a login for anyone else.
   */
  app.post<{ Params: WorldParams }>("/api/v1/worlds/:worldId/members", async (request, reply) => {
    const viewer = viewerForWorld(request, request.params.worldId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can add members.");
    const input = addMemberInputSchema.parse(request.body);
    const member = await addOrCreateMember(
      request.params.worldId,
      input.username,
      input.role,
      input.name,
      input.password,
    );
    reply.code(201);
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

  /** A DM resetting a member's forgotten password — there is no email to send a link to. */
  app.post<{ Params: WorldParams & { userId: string } }>(
    "/api/v1/worlds/:worldId/members/:userId/reset-password",
    async (request) => {
      const viewer = viewerForWorld(request, request.params.worldId);
      if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can reset passwords.");
      const input = resetPasswordInputSchema.parse(request.body);
      await resetMemberPassword(request.params.worldId, request.params.userId, input.newPassword);
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
