import type { Role, WorldDto } from "@dndworldapp/schema";
import { db, transaction } from "../db/index.ts";
import type { MembershipRow, WorldRow } from "../db/types.ts";
import { longId, shortId } from "../lib/id.ts";
import { FIRST_KEY } from "../lib/sortkey.ts";
import { slugify, uniqueSlug } from "../lib/slug.ts";

const insertWorld = db.prepare(
  "INSERT INTO worlds (id, name, slug, owner_id, settings, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)",
);
const insertMembership = db.prepare(
  "INSERT INTO memberships (world_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
);
const insertNode = db.prepare(`
  INSERT INTO nodes (id, world_id, parent_id, template_id, kind, title, slug, body_md, icon,
                     sort_key, visibility, created_by, created_at, updated_at)
  VALUES (?, ?, NULL, NULL, 'document', ?, ?, ?, ?, ?, 'members', ?, ?, ?)
`);
const worldSlugTaken = db.prepare("SELECT 1 FROM worlds WHERE slug = ?");
const selectWorld = db.prepare("SELECT * FROM worlds WHERE id = ?");
const selectMembership = db.prepare(
  "SELECT * FROM memberships WHERE world_id = ? AND user_id = ?",
);
const selectWorldsForUser = db.prepare(`
  SELECT w.*, m.role FROM worlds w
  JOIN memberships m ON m.world_id = w.id
  WHERE m.user_id = ?
  ORDER BY w.created_at
`);
const selectFirstRootNode = db.prepare(`
  SELECT id FROM nodes WHERE world_id = ? AND parent_id IS NULL AND is_archived = 0
  ORDER BY sort_key LIMIT 1
`);

const HOME_BODY = [
  "This is the root of your world. Everything nests under it, and nothing is filed by type.",
  "",
  "Make a child page for anything — a region, a person, a session log, a map — and drag it",
  "wherever it belongs. Link between pages with `[[double brackets]]`.",
].join("\n");

export function createWorld(ownerId: string, name: string): WorldRow {
  const id = longId();
  const slug = uniqueSlug(slugify(name), (candidate) => worldSlugTaken.get(candidate) !== undefined);
  const now = Date.now();

  transaction(() => {
    insertWorld.run(id, name, slug, ownerId, now, now);
    insertMembership.run(id, ownerId, "owner" satisfies Role, now);
    // icon is an emoji: the client renders it verbatim.
    insertNode.run(shortId(), id, name, "home", HOME_BODY, "🏠", FIRST_KEY, ownerId, now, now);
  });

  return selectWorld.get(id) as WorldRow;
}

export function getWorld(worldId: string): WorldRow | null {
  return (selectWorld.get(worldId) as WorldRow | undefined) ?? null;
}

export function roleFor(worldId: string, userId: string | null): Role | null {
  if (userId === null) return null;
  const row = selectMembership.get(worldId, userId) as MembershipRow | undefined;
  return row?.role ?? null;
}

export function addMember(worldId: string, userId: string, role: Role): void {
  insertMembership.run(worldId, userId, role, Date.now());
}

const selectMembers = db.prepare(`
  SELECT u.id, u.name, u.email, m.role FROM memberships m
  JOIN users u ON u.id = m.user_id
  WHERE m.world_id = ?
  ORDER BY m.created_at
`);
const findUserByEmail = db.prepare("SELECT id FROM users WHERE lower(email) = lower(?)");
const deleteMembership = db.prepare("DELETE FROM memberships WHERE world_id = ? AND user_id = ?");

export type MemberDto = {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function listMembers(worldId: string): MemberDto[] {
  return selectMembers.all(worldId) as MemberDto[];
}

/** Returns null when no account exists for that address — invites land in P2. */
export function addMemberByEmail(worldId: string, email: string, role: Role): MemberDto | null {
  const user = findUserByEmail.get(email) as { id: string } | undefined;
  if (user === undefined) return null;
  db.prepare(
    "INSERT INTO memberships (world_id, user_id, role, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT (world_id, user_id) DO UPDATE SET role = excluded.role",
  ).run(worldId, user.id, role, Date.now());
  return listMembers(worldId).find((m) => m.id === user.id) ?? null;
}

export function removeMember(worldId: string, userId: string): void {
  const world = getWorld(worldId);
  if (world !== null && world.owner_id === userId) return; // never orphan a world
  deleteMembership.run(worldId, userId);
}

export function listWorldsForUser(userId: string): WorldDto[] {
  const rows = selectWorldsForUser.all(userId) as Array<WorldRow & { role: Role }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role,
    rootNodeId: (selectFirstRootNode.get(row.id) as { id: string } | undefined)?.id ?? null,
  }));
}
