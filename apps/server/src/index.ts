import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";
import { purgeExpiredSessions } from "./auth/session.ts";
import { appliedMigrations, closeDatabase } from "./db/index.ts";
import { assertProductionSafe, env, paths } from "./env.ts";
import { assertScope, attachUser } from "./http/context.ts";
import { HttpError, forbidden } from "./lib/errors.ts";
import { authRoutes } from "./routes/auth.ts";
import { nodeRoutes } from "./routes/nodes.ts";
import { tokenRoutes } from "./routes/tokens.ts";
import { worldRoutes } from "./routes/worlds.ts";

assertProductionSafe();

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "..", "..", "web", "dist");

const app = Fastify({
  logger: { level: env.logLevel },
  bodyLimit: 8 * 1024 * 1024,
  trustProxy: true,
});

await app.register(cookie, { secret: env.sessionSecret });
await app.register(multipart);

app.decorateRequest("user", null);
app.decorateRequest("tokenAuth", null);
app.addHook("onRequest", async (request) => {
  attachUser(request);
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

app.get("/healthz", async () => ({
  ok: true,
  migrations: appliedMigrations.length,
  uptime: Math.round(process.uptime()),
}));

await app.register(authRoutes);
await app.register(worldRoutes);
await app.register(nodeRoutes);
await app.register(tokenRoutes);

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

// The built client, when it exists. In development Vite serves it on its own port.
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: "/", decorateReply: true });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
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
