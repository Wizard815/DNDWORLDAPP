import type { FastifyInstance } from "fastify";
import { viewerForWorld } from "../http/context.ts";
import { HttpError } from "../lib/errors.ts";
import { subscribe } from "../services/events.ts";

const HEARTBEAT_MS = 30_000;

interface WorldParams {
  worldId: string;
}

/**
 * GET /api/v1/worlds/{worldId}/events, upgraded to a WebSocket: a stream of
 * WorldEvent JSON messages (services/events.ts). Same auth as any read —
 * session cookie or a world:read bearer token — checked once at connect.
 * Server → client only; anything a client sends is ignored. The connection
 * is pinged every 30 s so idle proxies don't drop it.
 */
export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: WorldParams }>("/api/v1/worlds/:worldId/events", { websocket: true }, (socket, request) => {
    let viewer;
    try {
      viewer = viewerForWorld(request, request.params.worldId);
    } catch (error) {
      socket.close(1008, error instanceof HttpError ? error.message : "Not allowed.");
      return;
    }
    const unsubscribe = subscribe({
      worldId: request.params.worldId,
      viewer,
      send: (data) => socket.send(data),
    });
    socket.send(JSON.stringify({ type: "hello" }));
    const heartbeat = setInterval(() => socket.ping(), HEARTBEAT_MS);
    socket.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
