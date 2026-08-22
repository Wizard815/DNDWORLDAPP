import type { FastifyInstance } from "fastify";
import { notFound } from "../lib/errors.ts";
import { getSharedNode, getSharedTree } from "../services/shareLinks.ts";

interface TreeParams {
  token: string;
}
interface NodeParams {
  token: string;
  nodeId: string;
}

/**
 * The anonymous half of a share link — no cookie, no bearer token, nothing in
 * `attachUser` applies here. The token in the URL *is* the credential, so an
 * unknown or revoked one is reported as "not found," the same shape as every
 * other hidden-content case in this API, not as "forbidden."
 */
export async function shareRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: TreeParams }>("/api/v1/share/:token/tree", async (request) => {
    const scope = getSharedTree(request.params.token);
    if (scope === null) throw notFound("No such share link.");
    return { rootId: scope.rootId, nodes: scope.nodes };
  });

  app.get<{ Params: NodeParams }>("/api/v1/share/:token/nodes/:nodeId", async (request) => {
    const node = getSharedNode(request.params.token, request.params.nodeId);
    if (node === null) throw notFound("No such page.");
    return { node };
  });
}
