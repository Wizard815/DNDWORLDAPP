import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";
import { isGameMaster } from "./auth/policy.ts";
import { purgeExpiredSessions } from "./auth/session.ts";
import { purgeTrash } from "./services/nodes.ts";
import { appliedMigrations, closeDatabase, db } from "./db/index.ts";
import { assertProductionSafe, env, paths } from "./env.ts";
import { assertScope, attachUser, viewerForNode } from "./http/context.ts";
import { registerLiveEvents } from "./http/liveEvents.ts";
import { HttpError, forbidden } from "./lib/errors.ts";
import { authRoutes } from "./routes/auth.ts";
import { eventRoutes } from "./routes/events.ts";
import { iconRoutes } from "./routes/icons.ts";
import { mapRoutes } from "./routes/maps.ts";
import { nodeRoutes } from "./routes/nodes.ts";
import { openApiRoutes } from "./routes/openapi.ts";
import { shareRoutes } from "./routes/share.ts";
import { tokenRoutes } from "./routes/tokens.ts";
import { worldRoutes } from "./routes/worlds.ts";
import { foggedTile } from "./services/fog.ts";
import { getMapRowIfAny, mapImageInfo, recoverStuckTiling } from "./services/maps.ts";
import { backfillLinksStrippedOfSecrets, requireVisibleNode } from "./services/nodes.ts";
import { roleFor } from "./services/worlds.ts";

assertProductionSafe();

/**
 * One-time JS-driven data repair, tracked in the same `_migrations` ledger the
 * SQL migrations use so it runs exactly once ever. See backfillLinksStrippedOfSecrets's
 * own comment for why this is not a migrations/*.sql file.
 */
function runOnceAtBoot(name: string, fn: () => void): void {
  const already = db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get(name);
  if (already !== undefined) return;
  fn();
  db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(name, Date.now());
}
runOnceAtBoot("_backfill_links_stripped_of_secrets", backfillLinksStrippedOfSecrets);
recoverStuckTiling();

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "..", "..", "web", "dist");

const app = Fastify({
  logger: { level: env.logLevel },
  bodyLimit: 8 * 1024 * 1024,
  trustProxy: true,
});

await app.register(cookie, { secret: env.sessionSecret });
await app.register(multipart);
await app.register(websocket);

app.decorateRequest("user", null);
app.decorateRequest("tokenAuth", null);
app.addHook("onRequest", async (request) => {
  attachUser(request);
});

/**
 * A fogged map's source image. /media/ URLs are content-addressed capability
 * URLs (HANDOFF §8.2) and stay that way for every other upload — but while a
 * map has fog on, its raw image is refused to anyone who isn't an owner/DM of
 * that map's world, so a player who loaded the map before fog went on can't
 * just reopen the link they already have. Players get the server-fogged copy
 * instead (services/fog.ts).
 */
const selectFoggedMapsForAsset = db.prepare(`
  SELECT n.world_id AS worldId FROM maps m
  JOIN assets a ON a.id = m.asset_id
  JOIN nodes n ON n.id = m.node_id
  WHERE a.sha256 = ? AND m.fog_enabled = 1`);
app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/media/")) return;
  const sha = /^\/media\/[0-9a-f]{2}\/([0-9a-f]{64})/.exec(request.url)?.[1];
  if (sha === undefined) return;
  const fogged = selectFoggedMapsForAsset.all(sha) as { worldId: string }[];
  if (fogged.length === 0) return;
  const userId = request.user?.id ?? null;
  const allowed = userId !== null && fogged.every((m) => isGameMaster(roleFor(m.worldId, userId)));
  if (!allowed) {
    return reply.code(404).send({ error: { code: "not_found", message: "No such file." } });
  }
});

/**
 * Every other upload keeps its year-long immutable cache header, but a map's
 * source image must be re-checked on each load: otherwise a player's browser
 * would keep showing its cached copy after fog went on without ever asking
 * the server again. ETags keep the revalidation cheap.
 */
const selectMapsForAsset = db.prepare("SELECT 1 FROM maps m JOIN assets a ON a.id = m.asset_id WHERE a.sha256 = ? LIMIT 1");
app.addHook("onSend", async (request, reply, payload) => {
  if (!request.url.startsWith("/media/")) return payload;
  const sha = /^\/media\/[0-9a-f]{2}\/([0-9a-f]{64})/.exec(request.url)?.[1];
  if (sha !== undefined && selectMapsForAsset.get(sha) !== undefined) {
    reply.header("cache-control", "private, no-cache");
  }
  return payload;
});

/**
 * Map tiles are served as plain static files under /tiles/<mapNodeId>/z/x/y.webp
 * — outside /api/v1/, so the scope hook below never sees them, and outside
 * @fastify/static's own reach to add per-request logic. Unlike /media/'s
 * sha256-addressed images (unguessable, so treated as a capability URL — see
 * HANDOFF.md §8.2), a tile path is keyed by the map's own short node id, which
 * appears in the URL bar, every tree response, and every share-link payload.
 * A dm-only map's tiles must not outlive its visibility just because a player
 * once saw the id. Gated here, on the root app, so it runs before
 * @fastify/static's handler regardless of registration order (Fastify wires
 * hooks by encapsulation, not by when register() was called).
 */
app.addHook("onRequest", async (request, reply) => {
  if (!request.url.startsWith("/tiles/")) return;
  const mapNodeId = request.url.slice("/tiles/".length).split("/")[0]?.split("?")[0];
  if (mapNodeId === undefined || mapNodeId.length === 0) {
    return reply.code(404).send({ error: { code: "not_found", message: "No such endpoint." } });
  }
  try {
    const { viewer } = viewerForNode(request, mapNodeId);
    requireVisibleNode(mapNodeId, viewer);

    // Fog of war: a player's tiles are darkened here, from the same files,
    // so the raw pyramid is never served to them. `?as=player` lets a DM's
    // "view as a player" preview get the same tiles — it only ever narrows.
    const row = getMapRowIfAny(mapNodeId);
    const asPlayer = /[?&]as=player(&|$)/.test(request.url);
    if (row !== null && row.fog_enabled === 1 && (asPlayer || !isGameMaster(viewer.role))) {
      const match = /^\/tiles\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.webp(\?|$)/.exec(request.url);
      const tilePath = match !== null ? path.join(paths.tiles, mapNodeId, match[1]!, match[2]!, `${match[3]}.webp`) : null;
      if (match === null || tilePath === null || !fs.existsSync(tilePath)) {
        return reply.code(404).send({ error: { code: "not_found", message: "No such tile." } });
      }
      const image = mapImageInfo(row);
      const tile = await foggedTile(
        row,
        tilePath,
        { z: Number(match[1]), row: Number(match[2]), col: Number(match[3]) },
        image.width,
        image.height,
      );
      return reply
        .header("cache-control", /[?&]v=/.test(request.url) ? "private, max-age=31536000, immutable" : "private, no-cache")
        .type("image/webp")
        .send(tile);
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }
    throw error;
  }
});

/**
 * Scope enforcement for bearer tokens, in one place rather than per route.
 * Reads need `world:read`, anything that changes data needs `world:write`, and
 * account or membership management needs `admin`.
 */
app.addHook("preHandler", async (request) => {
  if (request.tokenAuth === null) return;
  if (!request.url.startsWith("/api/v1/")) return;

  const path = request.url.split("?")[0] ?? "";

  // The spec is a public contract, not data.
  if (path === "/api/v1/openapi.json" || path === "/api/v1/docs") return;

  // Tokens may not manage tokens: that would route around their own scopes.
  if (path.startsWith("/api/v1/tokens")) {
    throw forbidden("Tokens cannot manage tokens. Sign in to do that.");
  }

  if (path.startsWith("/api/v1/users") || path.includes("/members")) {
    assertScope(request, "admin");
    return;
  }

  const isRead = request.method === "GET" || request.method === "HEAD";
  assertScope(request, isRead ? "world:read" : "world:write");
});

app.setErrorHandler((error: unknown, request, reply) => {
  if (error instanceof HttpError) {
    return reply
      .code(error.statusCode)
      .send({ error: { code: error.code, message: error.message, details: error.details } });
  }
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: { code: "invalid_input", message: "That input is not valid.", details: error.issues },
    });
  }
  // Fastify's own errors (bad JSON, payload too large, unknown route) carry a status.
  const fastifyError = error as { statusCode?: number; code?: string; message?: string };
  if (typeof fastifyError.statusCode === "number" && fastifyError.statusCode < 500) {
    return reply.code(fastifyError.statusCode).send({
      error: {
        code: fastifyError.code ?? "request_error",
        message: fastifyError.message ?? "Bad request.",
      },
    });
  }
  request.log.error({ err: error }, "unhandled error");
  return reply
    .code(500)
    .send({ error: { code: "internal", message: "Something went wrong on the server." } });
});

registerLiveEvents(app);

app.get("/healthz", async () => ({
  ok: true,
  migrations: appliedMigrations.length,
  uptime: Math.round(process.uptime()),
}));

await app.register(authRoutes);
await app.register(eventRoutes);
await app.register(worldRoutes);
await app.register(nodeRoutes);
await app.register(mapRoutes);
await app.register(shareRoutes);
await app.register(tokenRoutes);
await app.register(openApiRoutes);
await app.register(iconRoutes);

// Uploaded images, under /media so they cannot collide with the client bundle
// that Vite emits into /assets. Content-addressed, so they cache forever.
await app.register(fastifyStatic, {
  root: paths.assets,
  prefix: "/media/",
  decorateReply: false,
  cacheControl: true,
  maxAge: "365d",
  immutable: true,
});

// Map tile pyramids, one directory per map node. Not content-addressed (a map's
// tiles are replaced wholesale when its source image changes), so no long-lived
// cache header — see services/maps.ts's startTiling().
await app.register(fastifyStatic, {
  root: paths.tiles,
  prefix: "/tiles/",
  decorateReply: false,
});

// The built client, when it exists. In development Vite serves it on its own port.
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: "/", decorateReply: true });
  app.setNotFoundHandler((request, reply) => {
    // A missing static file (a stale/never-generated map tile, an asset that was never
    // uploaded) must 404 for real — falling through to the SPA shell would silently
    // hand back index.html with a 200, which content-type-agnostic callers (an <img>
    // tag, a fetch() checking only .ok) can't distinguish from a genuine hit.
    const url = request.url;
    if (url.startsWith("/api/") || url.startsWith("/media/") || url.startsWith("/tiles/") || url.startsWith("/icons/")) {
      return reply.code(404).send({ error: { code: "not_found", message: "No such endpoint." } });
    }
    return reply.sendFile("index.html");
  });
} else {
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: { code: "not_found", message: "No such endpoint." } }),
  );
}

purgeExpiredSessions();
const sessionSweep = setInterval(purgeExpiredSessions, 6 * 60 * 60 * 1000);
sessionSweep.unref();

// The trash empties itself: anything trashed more than 30 days ago goes for
// good, at boot and once a day after (see services/nodes.ts purgeTrash).
const purgedAtBoot = purgeTrash();
if (purgedAtBoot > 0) app.log.info({ purged: purgedAtBoot }, "emptied expired trash");
const trashSweep = setInterval(() => {
  const purged = purgeTrash();
  if (purged > 0) app.log.info({ purged }, "emptied expired trash");
}, 24 * 60 * 60 * 1000);
trashSweep.unref();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().then(() => {
      closeDatabase();
      process.exit(0);
    });
  });
}

await app.listen({ port: env.port, host: env.host });
app.log.info({ dataDir: env.dataDir, webDist: fs.existsSync(webDist) }, "dndworldapp ready");
