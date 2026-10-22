import fs from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createMapGroupInputSchema,
  createMarkerInputSchema,
  moveMapGroupInputSchema,
  putFogMaskInputSchema,
  setMapImageInputSchema,
  updateMapGroupInputSchema,
  updateMapInputSchema,
  updateMarkerInputSchema,
} from "@dndworldapp/schema";
import { isGameMaster } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import { viewerForNode } from "../http/context.ts";
import { forbidden, notFound } from "../lib/errors.ts";
import { foggedImage, paintedMaskPng, savePaintedMask } from "../services/fog.ts";
import { assertKnownIcon } from "../services/icons.ts";
import {
  createMapGroup,
  deleteMapGroup,
  listMapGroups,
  moveMapGroup,
  selectGroupMapNode,
  updateMapGroup,
} from "../services/mapGroups.ts";
import {
  createMarker,
  deleteMarker,
  getMap,
  getMapRow,
  listMarkers,
  mapImageInfo,
  requireMapNode,
  setMapImage,
  updateMap,
  updateMarker,
} from "../services/maps.ts";

interface NodeParams {
  nodeId: string;
}
interface MarkerParams {
  markerId: string;
}
interface GroupParams {
  groupId: string;
}

const selectMarkerMapNode = db.prepare("SELECT map_node_id FROM map_markers WHERE id = ?");

/** Markers are addressed directly (`/markers/:markerId`), so their world comes via the owning map node. */
function viewerForMarker(markerId: string, request: FastifyRequest): { viewer: Viewer; mapNodeId: string } {
  const row = selectMarkerMapNode.get(markerId) as { map_node_id: string } | undefined;
  if (row === undefined) throw notFound("No such marker.");
  const { viewer } = viewerForNode(request, row.map_node_id);
  return { viewer, mapNodeId: row.map_node_id };
}

/** Groups are addressed directly (`/map-groups/:groupId`), same reasoning as viewerForMarker. */
function viewerForGroup(groupId: string, request: FastifyRequest): { viewer: Viewer; mapNodeId: string } {
  const row = selectGroupMapNode.get(groupId) as { map_node_id: string } | undefined;
  if (row === undefined) throw notFound("No such group.");
  const { viewer } = viewerForNode(request, row.map_node_id);
  return { viewer, mapNodeId: row.map_node_id };
}

export async function mapRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const map = getMap(request.params.nodeId, viewer);
    if (map === null) throw notFound("This page has no map set.");
    return { map };
  });

  app.put<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = setMapImageInputSchema.parse(request.body);
    const map = await setMapImage(request.params.nodeId, viewer, input.assetId, input.fog);
    return { map };
  });

  app.patch<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = updateMapInputSchema.parse(request.body);
    return { map: updateMap(request.params.nodeId, viewer, input) };
  });

  /**
   * The map image as a player sees it under fog — what a player's MapDto
   * points at instead of the raw /media URL. Always the fogged view, for
   * anyone who can see the map, so a DM previewing as a player (whose <img>
   * requests carry no view-as header) gets the same thing their players do.
   */
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map/view.webp", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const row = getMapRow(request.params.nodeId, viewer);
    const image = mapImageInfo(row);
    if (row.fog_enabled !== 1) {
      return reply.header("cache-control", "private, no-cache").type("image/webp").send(fs.createReadStream(image.path));
    }
    const file = await foggedImage(row, image.path, image.width, image.height);
    return reply
      .header("cache-control", "private, max-age=31536000, immutable") // the URL carries the fog version
      .type("image/webp")
      .send(fs.createReadStream(file));
  });

  /** The DM's painted fog mask (white revealed, black hidden) as a PNG. Owner/DM only. */
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map/fog", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can see the fog mask.");
    const row = getMapRow(request.params.nodeId, viewer);
    const image = mapImageInfo(row);
    const png = await paintedMaskPng(row.node_id, image.width, image.height);
    return reply.header("cache-control", "private, no-store").type("image/png").send(png);
  });

  app.put<{ Params: NodeParams }>(
    "/api/v1/nodes/:nodeId/map/fog",
    { bodyLimit: 16 * 1024 * 1024 },
    async (request) => {
      const { viewer } = viewerForNode(request, request.params.nodeId);
      requireMapNode(request.params.nodeId, viewer);
      if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can paint fog of war.");
      const input = putFogMaskInputSchema.parse(request.body);
      const row = getMapRow(request.params.nodeId, viewer);
      const image = mapImageInfo(row);
      const base64 = input.png.replace(/^data:image\/png;base64,/, "");
      await savePaintedMask(row.node_id, Buffer.from(base64, "base64"), image.width, image.height);
      return { map: getMap(row.node_id, viewer) };
    },
  );

  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map/markers", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    return { markers: listMarkers(request.params.nodeId, viewer) };
  });

  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map/markers", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = createMarkerInputSchema.parse(request.body);
    assertKnownIcon(input.icon);
    reply.code(201);
    return { marker: createMarker(request.params.nodeId, viewer, input) };
  });

  app.patch<{ Params: MarkerParams }>("/api/v1/markers/:markerId", async (request) => {
    const { viewer, mapNodeId } = viewerForMarker(request.params.markerId, request);
    const input = updateMarkerInputSchema.parse(request.body);
    assertKnownIcon(input.icon);
    return { marker: updateMarker(mapNodeId, request.params.markerId, viewer, input) };
  });

  app.delete<{ Params: MarkerParams }>("/api/v1/markers/:markerId", async (request) => {
    const { viewer, mapNodeId } = viewerForMarker(request.params.markerId, request);
    deleteMarker(mapNodeId, request.params.markerId, viewer);
    return { ok: true };
  });

  // Map groups (Kanka's MapGroup) — display categories any marker can join, separate from P4.5's token parentMarkerId.
  app.get<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map/groups", async (request) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    return { groups: listMapGroups(request.params.nodeId, viewer) };
  });

  app.post<{ Params: NodeParams }>("/api/v1/nodes/:nodeId/map/groups", async (request, reply) => {
    const { viewer } = viewerForNode(request, request.params.nodeId);
    const input = createMapGroupInputSchema.parse(request.body);
    reply.code(201);
    return { group: createMapGroup(request.params.nodeId, viewer, input) };
  });

  app.patch<{ Params: GroupParams }>("/api/v1/map-groups/:groupId", async (request) => {
    const { viewer, mapNodeId } = viewerForGroup(request.params.groupId, request);
    const input = updateMapGroupInputSchema.parse(request.body);
    return { group: updateMapGroup(mapNodeId, request.params.groupId, viewer, input) };
  });

  app.post<{ Params: GroupParams }>("/api/v1/map-groups/:groupId/move", async (request) => {
    const { viewer, mapNodeId } = viewerForGroup(request.params.groupId, request);
    const input = moveMapGroupInputSchema.parse(request.body);
    moveMapGroup(mapNodeId, request.params.groupId, viewer, input);
    return { ok: true };
  });

  app.delete<{ Params: GroupParams }>("/api/v1/map-groups/:groupId", async (request) => {
    const { viewer, mapNodeId } = viewerForGroup(request.params.groupId, request);
    deleteMapGroup(mapNodeId, request.params.groupId, viewer);
    return { ok: true };
  });
}
