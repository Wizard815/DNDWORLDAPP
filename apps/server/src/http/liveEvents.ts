import type { FastifyInstance, FastifyRequest } from "fastify";
import { db } from "../db/index.ts";
import { publish, publishForNode } from "../services/events.ts";

/**
 * Turns every successful write under /api/v1 into a live event
 * (services/events.ts), from its URL alone — one place, so a new route can't
 * forget to announce itself. What a marker, map group or post belongs to is
 * looked up before the handler runs, so a DELETE still knows which page it
 * changed after the row is gone.
 */

declare module "fastify" {
  interface FastifyRequest {
    liveEventNodeId?: string | null;
  }
}

const markerMap = db.prepare("SELECT map_node_id AS nodeId FROM map_markers WHERE id = ?");
const groupMap = db.prepare("SELECT map_node_id AS nodeId FROM map_groups WHERE id = ?");
const postNode = db.prepare("SELECT node_id AS nodeId FROM posts WHERE id = ?");

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

function pathOf(request: FastifyRequest): string {
  return request.url.split("?")[0] ?? "";
}

function ownerOf(path: string): string | null {
  const lookups: [RegExp, { get: (id: string) => unknown }][] = [
    [/^\/api\/v1\/markers\/([^/]+)/, markerMap],
    [/^\/api\/v1\/map-groups\/([^/]+)/, groupMap],
    [/^\/api\/v1\/posts\/([^/]+)/, postNode],
  ];
  for (const [pattern, statement] of lookups) {
    const id = pattern.exec(path)?.[1];
    if (id !== undefined) return (statement.get(id) as { nodeId: string } | undefined)?.nodeId ?? null;
  }
  return null;
}

/**
 * Whether a page PATCH changes anything the tree shows. Autosave sends only
 * `bodyMd` every few seconds while someone types; announcing that as a tree
 * change would make every connected client refetch the whole tree that often.
 */
function touchesTree(body: unknown): boolean {
  if (body === null || typeof body !== "object") return true;
  return Object.keys(body).some((key) => key !== "bodyMd");
}

export function registerLiveEvents(app: FastifyInstance): void {
  app.addHook("preHandler", async (request) => {
    if (!WRITE_METHODS.has(request.method)) return;
    request.liveEventNodeId = ownerOf(pathOf(request));
  });

  app.addHook("onResponse", async (request, reply) => {
    if (!WRITE_METHODS.has(request.method) || reply.statusCode >= 300) return;
    const path = pathOf(request);

    if (request.liveEventNodeId) {
      const nodeId = request.liveEventNodeId;
      publishForNode(nodeId, path.startsWith("/api/v1/posts/") ? { type: "node.changed", nodeId } : { type: "map.changed", nodeId });
      return;
    }

    const worldNodes = /^\/api\/v1\/worlds\/([^/]+)\/nodes$/.exec(path);
    if (worldNodes !== null) {
      publish(worldNodes[1]!, { type: "tree.changed" });
      return;
    }

    const node = /^\/api\/v1\/nodes\/([^/]+)(?:\/([^/]+))?/.exec(path);
    if (node === null) return;
    const [, nodeId, sub] = node as unknown as [string, string, string | undefined];
    if (sub === "map") {
      publishForNode(nodeId, { type: "map.changed", nodeId });
    } else if (sub === "move" || (sub === undefined && request.method === "DELETE")) {
      publishForNode(nodeId, { type: "tree.changed" });
    } else {
      // A page's own edit, or its posts/fields/ACL/template: the page changed,
      // and title/icon/visibility/ACL changes can reshape the tree too.
      publishForNode(nodeId, { type: "node.changed", nodeId });
      if (sub === "acl" || (sub === undefined && touchesTree(request.body))) {
        publishForNode(nodeId, { type: "tree.changed" });
      }
    }
  });
}
