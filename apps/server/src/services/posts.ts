import type { CreatePostInput, PostDto, UpdatePostInput } from "@dndworldapp/schema";
import { db } from "../db/index.ts";
import type { PostRow } from "../db/types.ts";
import { canEdit, visibilitySqlFor } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { forbidden, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { keyAfterAll } from "../lib/sortkey.ts";
import { requireVisibleNode } from "./nodes.ts";

/**
 * Posts are Kanka's entity notes: sections attached to a node, each carrying its
 * own visibility. This is how one page is player-facing while its DM briefing
 * underneath stays hidden. The hidden rows never leave the database — they are
 * filtered in SQL, not in the client.
 */

const selectPost = db.prepare("SELECT * FROM posts WHERE id = ?");
const postKeys = db.prepare("SELECT sort_key FROM posts WHERE node_id = ?");
const insertPost = db.prepare(`
  INSERT INTO posts (id, node_id, title, body_md, visibility, sort_key, created_by, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function toDto(row: PostRow): PostDto {
  return {
    id: row.id,
    nodeId: row.node_id,
    title: row.title,
    bodyMd: row.body_md,
    visibility: row.visibility,
    sortKey: row.sort_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPosts(nodeId: string, viewer: Viewer): PostDto[] {
  requireVisibleNode(nodeId, viewer);
  const vis = visibilitySqlFor(viewer.role, viewer.userId);
  const rows = db
    .prepare(`SELECT * FROM posts WHERE node_id = ? AND ${vis.sql} ORDER BY sort_key`)
    .all(nodeId, ...vis.params) as PostRow[];
  return rows.map(toDto);
}

export function createPost(nodeId: string, viewer: Viewer, input: CreatePostInput): PostDto {
  const node = requireVisibleNode(nodeId, viewer);
  if (!canEdit(viewer.role, node.created_by, viewer.userId)) {
    throw forbidden("You cannot add sections to this page.");
  }

  const id = shortId(12);
  const now = Date.now();
  const keys = (postKeys.all(nodeId) as Array<{ sort_key: string }>).map((r) => r.sort_key);

  insertPost.run(
    id,
    nodeId,
    input.title,
    input.bodyMd,
    input.visibility,
    keyAfterAll(keys),
    viewer.userId,
    now,
    now,
  );
  return toDto(selectPost.get(id) as PostRow);
}

function requireVisiblePost(postId: string, viewer: Viewer): PostRow {
  const row = selectPost.get(postId) as PostRow | undefined;
  if (row === undefined) throw notFound("No such section.");
  const vis = visibilitySqlFor(viewer.role, viewer.userId);
  const allowed = db
    .prepare(`SELECT 1 FROM posts WHERE id = ? AND ${vis.sql}`)
    .get(postId, ...vis.params);
  if (allowed === undefined) throw notFound("No such section.");
  return row;
}

export function updatePost(postId: string, viewer: Viewer, input: UpdatePostInput): PostDto {
  const existing = requireVisiblePost(postId, viewer);
  if (!canEdit(viewer.role, existing.created_by, viewer.userId)) {
    throw forbidden("You cannot edit this section.");
  }

  db.prepare(
    "UPDATE posts SET title = ?, body_md = ?, visibility = ?, updated_at = ? WHERE id = ?",
  ).run(
    input.title ?? existing.title,
    input.bodyMd ?? existing.body_md,
    input.visibility ?? existing.visibility,
    Date.now(),
    postId,
  );
  return toDto(selectPost.get(postId) as PostRow);
}

export function deletePost(postId: string, viewer: Viewer): void {
  const existing = requireVisiblePost(postId, viewer);
  if (!canEdit(viewer.role, existing.created_by, viewer.userId)) {
    throw forbidden("You cannot delete this section.");
  }
  db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
}
