import type { FastifyInstance } from "fastify";
import { createRelationInputSchema, updateRelationInputSchema } from "@dndworldapp/schema";
import { viewerForNode, viewerForWorld } from "../http/context.ts";
import { notFound } from "../lib/errors.ts";
import {
  connectionsFor,
  createRelation,
  deleteRelation,
  listRelationsFor,
  relationLabels,
  relationWorld,
  updateRelation,
} from "../services/relations.ts";

interface NodeParams {
  nodeId: string;
}
interface RelationParams {
  relationId: string;
}
interface WorldParams {
  worldId: string;
}

/** Relations (migration 0018) and the Connections panel. Rules live in services/relations.ts. */
export async function relationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/relations", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    return { relations: listRelationsFor(request.params.nodeId, viewer) };
  });

  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/relations", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = createRelationInputSchema.parse(request.body);
    reply.code(201);
    return { relation: createRelation(request.params.nodeId, viewer, input) };
  });

  /** A relation is addressed directly; the world (and so the viewer) comes from its row. */
  function viewerForRelation(request: Parameters<typeof viewerForWorld>[0], relationId: string) {
    const worldId = relationWorld(relationId);
    if (worldId === null) throw notFound("No such relation.");
    return viewerForWorld(request, worldId);
  }

  app.patch<{ Params: RelationParams }>("/api/v1/relations/:relationId", async (request) => {
    const viewer = viewerForRelation(request, request.params.relationId);
    const input = updateRelationInputSchema.parse(request.body);
    return { relation: updateRelation(request.params.relationId, viewer, input) };
  });

  app.delete<{ Params: RelationParams }>("/api/v1/relations/:relationId", async (request) => {
    const viewer = viewerForRelation(request, request.params.relationId);
    deleteRelation(request.params.relationId, viewer);
    return { ok: true };
  });

  app.get<{ Params: WorldParams }>("/api/v1/worlds/:worldId/relation-labels", async (request) => {
    const viewer = viewerForWorld(request, request.params.worldId);
    return { labels: relationLabels(request.params.worldId, viewer) };
  });

  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/connections", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    return { connections: connectionsFor(request.params.nodeId, viewer) };
  });
}
