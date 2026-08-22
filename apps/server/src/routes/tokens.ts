import type { FastifyInstance } from "fastify";
import { createTokenInputSchema } from "@dndworldapp/schema";
import { createToken, listTokens, revokeTokenForUser, toTokenDto } from "../auth/tokens.ts";
import { requireUser, viewerForWorld } from "../http/context.ts";
import { notFound } from "../lib/errors.ts";

/**
 * Token management is deliberately session-only — see the guard in index.ts.
 * A token that could mint tokens would be an escalation path around its own scopes
 * and expiry.
 */
export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/tokens", async (request) => ({
    tokens: listTokens(requireUser(request).id),
  }));

  app.post("/api/v1/tokens", async (request, reply) => {
    const user = requireUser(request);
    const input = createTokenInputSchema.parse(request.body ?? {});

    // Pinning to a world you are not a member of would mint a dead token.
    if (input.worldId !== null && input.worldId !== undefined) {
      viewerForWorld(request, input.worldId);
    }

    const { row, secret } = createToken(user.id, input);
    reply.code(201);
    return { token: toTokenDto(row), secret };
  });

  app.delete<{ Params: { tokenId: string } }>("/api/v1/tokens/:tokenId", async (request) => {
    const user = requireUser(request);
    if (!revokeTokenForUser(request.params.tokenId, user.id)) {
      throw notFound("No such token.");
    }
    return { ok: true };
  });
}
