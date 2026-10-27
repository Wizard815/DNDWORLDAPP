import type { FastifyInstance } from "fastify";
import { createTagInputSchema, mergeTagInputSchema, setNodeTagsInputSchema, updateTagInputSchema } from "@dndworldapp/schema";
import { isGameMaster } from "../auth/policy.ts";
import { viewerForNode, viewerForWorld } from "../http/context.ts";
import { forbidden, notFound } from "../lib/errors.ts";
import { canEditNode } from "../services/acl.ts";
import { listTagsWithCounts, pagesForTag, requireVisibleNode } from "../services/nodes.ts";
import { createTag, deleteTag, getTagRow, mergeTag, setManualTags, tagsFor, updateTag } from "../services/tags.ts";

interface WorldParams {
  worldId: string;
}
interface TagParams {
  tagId: string;
}
interface NodeParams {
  nodeId: string;
}

/**
 * Tags (migration 0017). Reading is open to every member including guests —
 * a tag's name is not campaign content — but every page list is filtered by
 * what the viewer may see, and a page the viewer can't see never affects a
 * count either. Managing tags (rename, color, merge, delete) is owner/DM;
 * tagging a page needs edit rights on that page.
 */
export async function tagRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: WorldParams }>("/api/v1/worlds/:worldId/tags", async (request) => {
    const viewer = viewerForWorld(request, request.params.worldId);
    return { tags: listTagsWithCounts(request.params.worldId, viewer) };
  });

  app.post<{ Params: WorldParams }>("/api/v1/worlds/:worldId/tags", async (request, reply) => {
    const viewer = viewerForWorld(request, request.params.worldId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can manage tags.");
    const input = createTagInputSchema.parse(request.body);
    reply.code(201);
    return { tag: createTag(request.params.worldId, input) };
  });

  /** Tags are addressed directly; the world (and so the viewer's role) comes from the tag row. */
  function gmForTag(request: Parameters<typeof viewerForWorld>[0], tagId: string) {
    const tag = getTagRow(tagId);
    if (tag === null) throw notFound("No such tag.");
    const viewer = viewerForWorld(request, tag.world_id);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can manage tags.");
    return { tag, viewer };
  }

  app.patch<{ Params: TagParams }>("/api/v1/tags/:tagId", async (request) => {
    gmForTag(request, request.params.tagId);
    const input = updateTagInputSchema.parse(request.body);
    return { tag: updateTag(request.params.tagId, input) };
  });

  app.delete<{ Params: TagParams }>("/api/v1/tags/:tagId", async (request) => {
    gmForTag(request, request.params.tagId);
    deleteTag(request.params.tagId);
    return { ok: true };
  });

  app.post<{ Params: TagParams }>("/api/v1/tags/:tagId/merge", async (request) => {
    gmForTag(request, request.params.tagId);
    const input = mergeTagInputSchema.parse(request.body);
    return { tag: mergeTag(request.params.tagId, input.intoTagId) };
  });

  app.get<{ Params: TagParams; Querystring: { children?: string } }>("/api/v1/tags/:tagId/pages", async (request) => {
    const tag = getTagRow(request.params.tagId);
    if (tag === null) throw notFound("No such tag.");
    const viewer = viewerForWorld(request, tag.world_id);
    const includeChildren = request.query.children !== "0" && request.query.children !== "false";
    return { nodes: pagesForTag(request.params.tagId, viewer, includeChildren) };
  });

  app.put<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/tags", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const node = requireVisibleNode(request.params.nodeId, viewer);
    if (!canEditNode(node, viewer)) throw forbidden("You cannot tag this page.");
    const input = setNodeTagsInputSchema.parse(request.body);
    setManualTags(node, input.tags);
    return { tags: tagsFor(node.id) };
  });
}
