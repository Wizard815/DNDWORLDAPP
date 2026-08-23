import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createFieldInputSchema,
  createPostInputSchema,
  grantAclInputSchema,
  moveFieldInputSchema,
  moveNodeInputSchema,
  updateFieldInputSchema,
  updateNodeInputSchema,
  updatePostInputSchema,
} from "@dndworldapp/schema";
import { isGameMaster } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import { viewerForNode, viewerForWorld } from "../http/context.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { grantAcl, listAcl, revokeAcl } from "../services/acl.ts";
import { createField, deleteField, listFields, moveField, updateField } from "../services/fields.ts";
import { archiveNode, getNodeDetail, getNodeRow, moveNode, updateNode } from "../services/nodes.ts";
import { createPost, deletePost, listPosts, updatePost } from "../services/posts.ts";
import { createShareLink, listShareLinks, revokeShareLink } from "../services/shareLinks.ts";
import { assignTemplateFields } from "../services/templates.ts";

interface NodeParams {
  nodeId: string;
}
interface PostParams {
  postId: string;
}
interface AclParams {
  nodeId: string;
  aclId: string;
}
interface ShareLinkParams {
  nodeId: string;
  shareLinkId: string;
}
interface FieldParams {
  nodeId: string;
  fieldId: string;
}

const selectPostNode = db.prepare("SELECT node_id FROM posts WHERE id = ?");
const selectNodeWorld = db.prepare("SELECT world_id FROM nodes WHERE id = ?");

export async function nodeRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    return { node: getNodeDetail(request.params.nodeId, viewer) };
  });

  app.patch<{ Params: NodeParams }>("/api/v1/nodes/:nodeId", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = updateNodeInputSchema.parse(request.body);
    updateNode(request.params.nodeId, viewer, input);
    return { node: getNodeDetail(request.params.nodeId, viewer) };
  });

  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/move", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = moveNodeInputSchema.parse(request.body);
    const node = moveNode(request.params.nodeId, viewer, input);
    return { node: { id: node.id, parentId: node.parent_id, sortKey: node.sort_key } };
  });

  app.delete<{ Params: NodeParams }>("/api/v1/nodes/:nodeId", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    archiveNode(request.params.nodeId, viewer);
    return { ok: true };
  });

  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/posts", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    return { posts: listPosts(request.params.nodeId, viewer) };
  });

  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/posts", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = createPostInputSchema.parse(request.body ?? {});
    reply.code(201);
    return { post: createPost(request.params.nodeId, viewer, input) };
  });

  app.patch<{ Params: PostParams }>("/api/v1/posts/:postId", async (request) => {
    const viewer = viewerForPost(request.params.postId, request);
    const input = updatePostInputSchema.parse(request.body);
    return { post: updatePost(request.params.postId, viewer, input) };
  });

  app.delete<{ Params: PostParams }>("/api/v1/posts/:postId", async (request) => {
    const viewer = viewerForPost(request.params.postId, request);
    deletePost(request.params.postId, viewer);
    return { ok: true };
  });

  /**
   * Per-node access grants. Owner/DM only — a viewer able to reach these routes
   * at all is always able to see the node itself (isGameMaster already implies
   * full visibility), so there is no separate visibility check to make here.
   */
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/acl", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can see access grants.");
    return { entries: listAcl(request.params.nodeId) };
  });

  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/acl", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can grant access.");
    const input = grantAclInputSchema.parse(request.body);
    reply.code(201);
    return { entry: grantAcl(request.params.nodeId, viewer, input) };
  });

  app.delete<{ Params: AclParams }>("/api/v1/nodes/:nodeId/acl/:aclId", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can revoke access.");
    revokeAcl(request.params.nodeId, request.params.aclId);
    return { ok: true };
  });

  /**
   * Share links. Owner/DM only to manage; the token itself (in routes/share.ts)
   * needs no auth at all — that is the point of it.
   */
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/share-links", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can see share links.");
    return { shareLinks: listShareLinks(request.params.nodeId) };
  });

  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/share-links", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can create share links.");
    reply.code(201);
    return createShareLink(request.params.nodeId, viewer);
  });

  app.delete<{ Params: ShareLinkParams }>(
    "/api/v1/nodes/:nodeId/share-links/:shareLinkId",
    async (request) => {
      const { viewer } = viewerForNode(request, request.params.nodeId);
      if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can revoke share links.");
      revokeShareLink(request.params.nodeId, request.params.shareLinkId);
      return { ok: true };
    },
  );

  /** Typed field values on a node. Same edit gate as a post: canEditNode. */
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/fields", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    return { fields: listFields(request.params.nodeId, viewer) };
  });

  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/fields", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = createFieldInputSchema.parse(request.body);
    reply.code(201);
    return { field: createField(request.params.nodeId, viewer, input) };
  });

  app.patch<{ Params: FieldParams }>("/api/v1/nodes/:nodeId/fields/:fieldId", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = updateFieldInputSchema.parse(request.body);
    return { field: updateField(request.params.nodeId, request.params.fieldId, viewer, input) };
  });

  app.delete<{ Params: FieldParams }>("/api/v1/nodes/:nodeId/fields/:fieldId", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    deleteField(request.params.nodeId, request.params.fieldId, viewer);
    return { ok: true };
  });

  app.post<{ Params: FieldParams }>(
    "/api/v1/nodes/:nodeId/fields/:fieldId/move",
    async (request) => {
      const { viewer } = viewerForNode(request, request.params.nodeId);
      const input = moveFieldInputSchema.parse(request.body);
      moveField(request.params.nodeId, request.params.fieldId, viewer, input);
      return { ok: true };
    },
  );

  /** Backfills any template fields the node is missing, without disturbing existing values. */
  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/apply-template", async (request) => {
    const { viewer, worldId } = viewerForNode(request, request.params.nodeId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can apply templates.");
    const node = getNodeRow(request.params.nodeId);
    if (node === null) throw notFound("No such node.");
    if (node.template_id === null) throw badRequest("This page has no template assigned.");
    assignTemplateFields(request.params.nodeId, worldId, node.template_id);
    return { fields: listFields(request.params.nodeId, viewer) };
  });

  /** Posts are addressed directly, so their world comes via the owning node. */
  function viewerForPost(postId: string, request: FastifyRequest): Viewer {
    const post = selectPostNode.get(postId) as { node_id: string } | undefined;
    if (post === undefined) throw notFound("No such section.");
    const node = selectNodeWorld.get(post.node_id) as { world_id: string } | undefined;
    if (node === undefined) throw notFound("No such section.");
    return viewerForWorld(request, node.world_id);
  }
}
