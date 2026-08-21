import type { FastifyInstance } from "fastify";
import { loginInputSchema, setupInputSchema } from "@dndworldapp/schema";
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
const findUserByEmail = db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)");
const insertUser = db.prepare(
  "INSERT INTO users (id, email, name, password_hash, is_server_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
);

function toDto(user: UserRow): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
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
   */
  app.post("/api/v1/setup", async (request, reply) => {
    if (!needsSetup()) throw conflict("This server has already been set up.");
    const input = setupInputSchema.parse(request.body);

    const userId = longId();
    insertUser.run(
      userId,
      input.email,
      input.name,
      await hashPassword(input.password),
      1,
      Date.now(),
    );
    const world = createWorld(userId, input.worldName);
    startSession(request, reply, userId);

    return { user: toDto(findUserByEmail.get(input.email) as UserRow), worldId: world.id };
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const input = loginInputSchema.parse(request.body);
    const user = findUserByEmail.get(input.email) as UserRow | undefined;

    // Same failure for unknown address and wrong password, and always pay the
    // hashing cost, so timing does not reveal which accounts exist.
    const stored = user?.password_hash ?? "scrypt$00$00";
    const ok = await verifyPassword(input.password, stored);
    if (user === undefined || !ok) throw unauthorized("Wrong email or password.");

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

  /** Invite flow is P2; for now an owner can hand-create an account. */
  app.post("/api/v1/users", async (request) => {
    const actor = requireUser(request);
    if (actor.is_server_admin !== 1) throw badRequest("Only a server admin can add users.");
    const input = setupInputSchema.omit({ worldName: true }).parse(request.body);
    if (findUserByEmail.get(input.email) !== undefined) throw conflict("That email is taken.");

    const userId = longId();
    insertUser.run(
      userId,
      input.email,
      input.name,
      await hashPassword(input.password),
      0,
      Date.now(),
    );
    return { user: toDto(findUserByEmail.get(input.email) as UserRow) };
  });
}
