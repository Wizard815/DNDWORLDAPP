import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createPostInputSchema,
  moveNodeInputSchema,
  updateNodeInputSchema,
  updatePostInputSchema,
} from "@dndworldapp/schema";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import { viewerForNode, viewerForWorld } from "../http/context.ts";
import { notFound } from "../lib/errors.ts";
import { archiveNode, getNodeDetail, moveNode, updateNode } from "../services/nodes.ts";
import { createPost, deletePost, listPosts, updatePost } from "../services/posts.ts";

interface NodeParams {
  nodeId: string;
}
interface PostParams {
  postId: string;
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

  /** Posts are addressed directly, so their world comes via the owning node. */
  function viewerForPost(postId: string, request: FastifyRequest): Viewer {
    const post = selectPostNode.get(postId) as { node_id: string } | undefined;
    if (post === undefined) throw notFound("No such section.");
    const node = selectNodeWorld.get(post.node_id) as { world_id: string } | undefined;
    if (node === undefined) throw notFound("No such section.");
    return viewerForWorld(request, node.world_id);
  }
}
