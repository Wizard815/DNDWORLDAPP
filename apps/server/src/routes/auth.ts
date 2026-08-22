import type { FastifyInstance } from "fastify";
import { changePasswordInputSchema, loginInputSchema, setupInputSchema } from "@dndworldapp/schema";
import type { UserDto } from "@dndworldapp/schema";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { SESSION_COOKIE, destroySession } from "../auth/session.ts";
import { db } from "../db/index.ts";
import type { UserRow } from "../db/types.ts";
import { badRequest, conflict, unauthorized } from "../lib/errors.ts";
import { longId } from "../lib/id.ts";
import { requireUser, startSession } from "../http/context.ts";
import { createWorld } from "../services/worlds.ts";

const countUsers = db.prepare("SELECT COUNT(*) AS n FROM users");
const findUserByUsername = db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)");
const insertUser = db.prepare(
  "INSERT INTO users (id, username, name, password_hash, is_server_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const updatePasswordHash = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");

function toDto(user: UserRow): UserDto {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    isServerAdmin: user.is_server_admin === 1,
  };
}

function needsSetup(): boolean {
  return (countUsers.get() as { n: number }).n === 0;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/setup/status", async () => ({ needsSetup: needsSetup() }));

  /**
   * First run. Creates the owner account and their first world, then signs in.
   * Deliberately a screen rather than environment variables — a container should
   * not need a redeploy to change who owns it.
   *
   * This is the only self-service account creation in the app. Every account
   * after this one is created by a human — the owner or a DM, via the world's
   * member panel (see routes/worlds.ts) — never by public signup. There is no
   * email anywhere in this system: no verification, no reset-by-email, because
   * a self-hosted homelab app has no mail server and never will.
   */
  app.post("/api/v1/setup", async (request, reply) => {
    if (!needsSetup()) throw conflict("This server has already been set up.");
    const input = setupInputSchema.parse(request.body);
    if (findUserByUsername.get(input.username) !== undefined) {
      throw conflict("That username is taken.");
    }

    const userId = longId();
    insertUser.run(
      userId,
      input.username,
      input.name,
      await hashPassword(input.password),
      1,
      Date.now(),
    );
    const world = createWorld(userId, input.worldName);
    startSession(request, reply, userId);

    return { user: toDto(findUserByUsername.get(input.username) as UserRow), worldId: world.id };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const input = loginInputSchema.parse(request.body);
    const user = findUserByUsername.get(input.username) as UserRow | undefined;

    // Same failure for unknown username and wrong password, and always pay the
    // hashing cost, so timing does not reveal which accounts exist.
    const stored = user?.password_hash ?? "scrypt$00$00";
    const ok = await verifyPassword(input.password, stored);
    if (user === undefined || !ok) throw unauthorized("Wrong username or password.");

    startSession(request, reply, user.id);
    return { user: toDto(user) };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined) destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/v1/auth/me", async (request) => ({ user: toDto(requireUser(request)) }));

  /** Self-service password change, requiring the current one. DM-driven resets
   *  (no current password needed, for when someone forgets theirs) live on the
   *  world member panel instead — see routes/worlds.ts. */
  app.post("/api/v1/auth/change-password", async (request) => {
    const user = requireUser(request);
    const input = changePasswordInputSchema.parse(request.body);
    const ok = await verifyPassword(input.currentPassword, user.password_hash);
    if (!ok) throw badRequest("Current password is wrong.");
    updatePasswordHash.run(await hashPassword(input.newPassword), user.id);
    return { ok: true };
  });
}
