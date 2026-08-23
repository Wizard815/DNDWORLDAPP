import type { FastifyInstance, FastifyRequest } from "fastify";
import { createMarkerInputSchema, setMapImageInputSchema, updateMarkerInputSchema } from "@dndworldapp/schema";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import { viewerForNode } from "../http/context.ts";
import { notFound } from "../lib/errors.ts";
import { createMarker, deleteMarker, getMap, listMarkers, setMapImage, updateMarker } from "../services/maps.ts";

interface NodeParams {
  nodeId: string;
}
interface MarkerParams {
  markerId: string;
}

const selectMarkerMapNode = db.prepare("SELECT map_node_id FROM map_markers WHERE id = ?");

/** Markers are addressed directly (`/markers/:markerId`), so their world comes via the owning map node. */
function viewerForMarker(markerId: string, request: FastifyRequest): { viewer: Viewer; mapNodeId: string } {
  const row = selectMarkerMapNode.get(markerId) as { map_node_id: string } | undefined;
  if (row === undefined) throw notFound("No such marker.");
  const { viewer } = viewerForNode(request, row.map_node_id);
  return { viewer, mapNodeId: row.map_node_id };
}

export async function mapRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map", async (request) => {
    viewerForNode(request, request.params.nodeId);
    const map = getMap(request.params.nodeId);
    if (map === null) throw notFound("This page has no map set.");
    return { map };
  });

  app.put<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = setMapImageInputSchema.parse(request.body);
    const map = await setMapImage(request.params.nodeId, viewer, input.assetId);
    return { map };
  });

  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map/markers", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    return { markers: listMarkers(request.params.nodeId, viewer) };
  });

  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map/markers", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = createMarkerInputSchema.parse(request.body);
    reply.code(201);
    return { marker: createMarker(request.params.nodeId, viewer, input) };
  });

  app.patch<{ Params: MarkerParams }>("/api/v1/markers/:markerId", async (request) => {
    const { viewer, mapNodeId } = viewerForMarker(request.params.markerId, request);
    const input = updateMarkerInputSchema.parse(request.body);
    return { marker: updateMarker(mapNodeId, request.params.markerId, viewer, input) };
  });

  app.delete<{ Params: MarkerParams }>("/api/v1/markers/:markerId", async (request) => {
    const { viewer, mapNodeId } = viewerForMarker(request.params.markerId, request);
    deleteMarker(mapNodeId, request.params.markerId, viewer);
    return { ok: true };
  });
}
