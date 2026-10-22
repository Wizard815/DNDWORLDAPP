import type { FastifyInstance } from "fastify";
import { iconSearchQuerySchema, parseIconRef } from "@dndworldapp/schema";
import { requireUser } from "../http/context.ts";
import { notFound } from "../lib/errors.ts";
import { iconSvg, searchIcons } from "../services/icons.ts";

export async function iconRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/icons", async (request) => {
    requireUser(request);
    const query = iconSearchQuerySchema.parse(request.query ?? {});
    return searchIcons(query.q, query.set, query.limit);
  });

  /**
   * One icon as an SVG file. No auth, deliberately: the library is bundled
   * open-licensed artwork, not campaign data, and an anonymous share-link
   * visitor's map shows marker icons too. Never changes for a given URL.
   */
  app.get<{ Params: { set: string; file: string } }>("/icons/:set/:file", async (request, reply) => {
    const ref = parseIconRef(`${request.params.set}:${request.params.file.replace(/\.svg$/, "")}`);
    const svg = ref !== null && request.params.file.endsWith(".svg") ? iconSvg(ref.set, ref.name) : null;
    if (svg === null) throw notFound("No such icon.");
    return reply
      .header("content-type", "image/svg+xml; charset=utf-8")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'")
      .send(svg);
  });
}
