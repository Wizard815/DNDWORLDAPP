import type {
  Backlink,
  CreateNodeInput,
  MoveNodeInput,
  NodeDetail,
  NodeSummary,
  SearchHit,
  UnresolvedLink,
  UpdateNodeInput,
} from "@dndworldapp/schema";
import { db, transaction } from "../db/index.ts";
import type { NodeRow } from "../db/types.ts";
import { canSeeSecrets, nodeAclSql, visibilitySqlFor } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { containsSecret, redactForViewer, stripSecrets } from "../lib/secrets.ts";
import { keyAfterAll, keyBetween } from "../lib/sortkey.ts";
import { slugify, uniqueSlug } from "../lib/slug.ts";
import { linkKey, parseWikilinks } from "../lib/wikilinks.ts";
import { canEditNode } from "./acl.ts";
import { assertTemplateInWorld, assignTemplateFields } from "./templates.ts";

/**
 * "Can this viewer read a node?" is node visibility OR a per-node ACL grant —
 * see nodeAclSql() in auth/policy.ts for why ACL only ever widens. `alias` is
 * the table alias in the surrounding query ("n", "c", or "" for a bare
 * `nodes` reference), so this one helper covers every read-path query below.
 */
function readableSql(alias: string, viewer: Viewer): { sql: string; params: Array<string | null> } {
  // Always qualify with a real table reference, never a bare "id" — the ACL
  // fragment below is a correlated subquery against a table that ALSO has its
  // own `id` column, so an unqualified "id" resolves to acl.id, not nodes.id,
  // and every grant silently fails to match. Cost a real debugging pass to
  // find; do not remove the qualifier "to simplify" it back into this trap.
  const prefix = alias.length > 0 ? `${alias}.` : "nodes.";
  const vis = visibilitySqlFor(viewer.role, viewer.userId, `${prefix}visibility`, `${prefix}created_by`);
  const acl = nodeAclSql(`${prefix}id`, viewer.role, viewer.userId, "read");
  return { sql: `(${vis.sql} OR ${acl.sql})`, params: [...vis.params, ...acl.params] };
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

const selectNode = db.prepare("SELECT * FROM nodes WHERE id = ?");
const slugTaken = db.prepare("SELECT 1 FROM nodes WHERE world_id = ? AND slug = ?");
const insertNode = db.prepare(`
  INSERT INTO nodes (id, world_id, parent_id, template_id, kind, title, slug, body_md, icon,
                     sort_key, visibility, created_by, created_at, updated_at)
  VALUES (@id, @worldId, @parentId, @templateId, @kind, @title, @slug, @bodyMd, @icon,
          @sortKey, @visibility, @createdBy, @now, @now)
`);
const siblingKeys = db.prepare(
  "SELECT sort_key FROM nodes WHERE world_id = ? AND parent_id IS ? AND id IS NOT ?",
);
const deleteLinksFrom = db.prepare("DELETE FROM links WHERE src_node_id = ?");
const insertLink = db.prepare(`
  INSERT INTO links (id, world_id, src_node_id, dst_node_id, target_text, label, kind, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'wikilink', ?)
`);
const findByTitleOrSlug = db.prepare(
  "SELECT id FROM nodes WHERE world_id = ? AND (lower(title) = ? OR slug = ?) LIMIT 1",
);
const resolvePending = db.prepare(`
  UPDATE links SET dst_node_id = ?
  WHERE world_id = ? AND dst_node_id IS NULL AND (lower(target_text) = ? OR lower(target_text) = ?)
`);
const unresolveStale = db.prepare(`
  UPDATE links SET dst_node_id = NULL
  WHERE dst_node_id = ? AND lower(target_text) NOT IN (?, ?)
`);
const deleteFtsRow = db.prepare("DELETE FROM nodes_fts WHERE node_id = ?");
const insertFtsRow = db.prepare(
  "INSERT INTO nodes_fts (node_id, world_id, title, body) VALUES (?, ?, ?, ?)",
);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function rowToSummary(row: NodeRow & { child_count?: number }): NodeSummary {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    slug: row.slug,
    icon: row.icon,
    kind: row.kind,
    visibility: row.visibility,
    sortKey: row.sort_key,
    childCount: row.child_count ?? 0,
    isArchived: row.is_archived === 1,
    updatedAt: row.updated_at,
  };
}

/**
 * The whole visible tree in one query. At campaign scale (thousands of nodes)
 * this is far cheaper than lazy-loading each level, and it lets the client do
 * instant filtering and quick-switching without another round trip.
 */
export function getTree(worldId: string, viewer: Viewer): NodeSummary[] {
  const outer = readableSql("n", viewer);
  const inner = readableSql("c", viewer);

  const sql = `
    SELECT n.*,
           (SELECT COUNT(*) FROM nodes c
             WHERE c.parent_id = n.id AND c.is_archived = 0 AND ${inner.sql}) AS child_count
    FROM nodes n
    WHERE n.world_id = ? AND n.is_archived = 0 AND ${outer.sql}
    ORDER BY n.sort_key
  `;
  const rows = db.prepare(sql).all(...inner.params, worldId, ...outer.params) as Array<
    NodeRow & { child_count: number }
  >;
  return rows.map(rowToSummary);
}

export function getNodeRow(nodeId: string): NodeRow | null {
  return (selectNode.get(nodeId) as NodeRow | undefined) ?? null;
}

/** Non-throwing form of requireVisibleNode, for call sites that need to degrade
 * gracefully rather than 404 — e.g. a marker or field that resolves its label
 * from a target node it links to, where an invisible target should fall back
 * to the marker/field's own override, not blow up the whole response. */
export function isNodeVisible(nodeId: string, viewer: Viewer): boolean {
  const read = readableSql("", viewer);
  return db.prepare(`SELECT 1 FROM nodes WHERE id = ? AND ${read.sql}`).get(nodeId, ...read.params) !== undefined;
}

/**
 * Fetch a node the viewer is allowed to see. A hidden node is reported as "not
 * found" rather than "forbidden", so probing ids cannot enumerate DM content.
 */
export function requireVisibleNode(nodeId: string, viewer: Viewer): NodeRow {
  const row = getNodeRow(nodeId);
  if (row === null) throw notFound("No such node.");
  if (!isNodeVisible(nodeId, viewer)) throw notFound("No such node.");
  return row;
}

export function getNodeDetail(nodeId: string, viewer: Viewer): NodeDetail {
  const row = requireVisibleNode(nodeId, viewer);
  const outer = readableSql("n", viewer);
  const inner = readableSql("c", viewer);

  const children = db
    .prepare(
      `SELECT n.*,
              (SELECT COUNT(*) FROM nodes c
                WHERE c.parent_id = n.id AND c.is_archived = 0 AND ${inner.sql}) AS child_count
       FROM nodes n
       WHERE n.parent_id = ? AND n.is_archived = 0 AND ${outer.sql}
       ORDER BY n.sort_key`,
    )
    .all(...inner.params, nodeId, ...outer.params) as Array<NodeRow & { child_count: number }>;

  return {
    ...rowToSummary(row),
    worldId: row.world_id,
    bodyMd: redactForViewer(row.body_md, canSeeSecrets(viewer.role)),
    templateId: row.template_id,
    breadcrumb: breadcrumbFor(row),
    children: children.map(rowToSummary),
    backlinks: backlinksFor(nodeId, viewer),
    canEdit: canEditNode(row, viewer),
  };
}

/** Walks parents to the root. The URL is flat, so the path is reconstructed here. */
export function breadcrumbFor(row: NodeRow): Array<{ id: string; title: string; icon: string | null }> {
  const trail: Array<{ id: string; title: string; icon: string | null }> = [];
  let current = row.parent_id;
  const guard = new Set<string>([row.id]);

  while (current !== null && !guard.has(current)) {
    guard.add(current);
    const parent = getNodeRow(current);
    if (parent === null) break;
    trail.unshift({ id: parent.id, title: parent.title, icon: parent.icon });
    current = parent.parent_id;
  }
  return trail;
}

export function backlinksFor(nodeId: string, viewer: Viewer): Backlink[] {
  const vis = readableSql("n", viewer);
  const rows = db
    .prepare(
      `SELECT DISTINCT n.id, n.title, n.icon, l.label
       FROM links l JOIN nodes n ON n.id = l.src_node_id
       WHERE l.dst_node_id = ? AND n.is_archived = 0 AND ${vis.sql}
       ORDER BY n.title`,
    )
    .all(nodeId, ...vis.params) as Array<{
    id: string;
    title: string;
    icon: string | null;
    label: string | null;
  }>;

  return rows.map((r) => ({ nodeId: r.id, title: r.title, icon: r.icon, label: r.label }));
}

/**
 * Wiki links pointing at pages that do not exist yet — a to-do list, not an
 * error. Scoped to links whose SOURCE node this viewer can read, same as
 * backlinksFor() — otherwise the target_text of a link written on a dm-only
 * page (or inside a :::secret block) would leak to every member.
 */
export function unresolvedLinks(worldId: string, viewer: Viewer): UnresolvedLink[] {
  const vis = readableSql("n", viewer);
  const rows = db
    .prepare(
      `SELECT l.target_text, COUNT(*) AS count FROM links l
       JOIN nodes n ON n.id = l.src_node_id
       WHERE l.world_id = ? AND l.dst_node_id IS NULL AND n.is_archived = 0 AND ${vis.sql}
       GROUP BY lower(l.target_text) ORDER BY count DESC, l.target_text LIMIT 200`,
    )
    .all(worldId, ...vis.params) as Array<{ target_text: string; count: number }>;
  return rows.map((r) => ({ targetText: r.target_text, count: r.count }));
}

export function searchNodes(
  worldId: string,
  viewer: Viewer,
  query: string,
  limit: number,
): SearchHit[] {
  const tokens = query
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, "").trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  const match = tokens.map((t) => `"${t}"*`).join(" ");

  const vis = readableSql("n", viewer);
  const rows = db
    .prepare(
      `SELECT f.node_id, n.title, n.icon,
              snippet(nodes_fts, 3, '<mark>', '</mark>', '…', 14) AS snippet
       FROM nodes_fts f JOIN nodes n ON n.id = f.node_id
       WHERE nodes_fts MATCH ? AND f.world_id = ? AND n.is_archived = 0 AND ${vis.sql}
       ORDER BY f.rank LIMIT ?`,
    )
    .all(match, worldId, ...vis.params, limit) as Array<{
    node_id: string;
    title: string;
    icon: string | null;
    snippet: string;
  }>;

  return rows.map((r) => ({
    nodeId: r.node_id,
    title: r.title,
    icon: r.icon,
    snippet: r.snippet,
  }));
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * Indexes wikilinks out of the SECRET-STRIPPED body, same as reindexFts below —
 * a `[[Target]]` written inside a `:::secret` block must not become a `links`
 * row at all, or it leaks the secret's target_text to every member via
 * unresolvedLinks()/backlinksFor(), neither of which can see inside the block
 * itself to re-check.
 */
function reindexLinks(row: NodeRow): void {
  deleteLinksFrom.run(row.id);
  const now = Date.now();
  for (const link of parseWikilinks(stripSecrets(row.body_md))) {
    const key = linkKey(link.target);
    const target = findByTitleOrSlug.get(row.world_id, key, slugify(link.target)) as
      | { id: string }
      | undefined;
    insertLink.run(shortId(12), row.world_id, row.id, target?.id ?? null, link.target, link.label, now);
  }
}

/** After a create or rename, adopt links that were waiting for this title. */
function resettleLinksFor(row: NodeRow): void {
  const title = linkKey(row.title);
  resolvePending.run(row.id, row.world_id, title, row.slug);
  unresolveStale.run(row.id, title, row.slug);
}

/**
 * Maintains nodes_fts. Was a SQL trigger until secret blocks arrived — a trigger
 * cannot run stripSecrets(), and indexing the raw body would let a search
 * snippet leak secret text to a player. So this runs in JS, explicitly, after
 * every create and title/body update. See migrations/0003_secret_blocks.sql.
 */
function reindexFts(row: NodeRow): void {
  deleteFtsRow.run(row.id);
  insertFtsRow.run(row.id, row.world_id, row.title, stripSecrets(row.body_md));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function nextSortKey(worldId: string, parentId: string | null, excludeId: string | null): string {
  const rows = siblingKeys.all(worldId, parentId, excludeId) as Array<{ sort_key: string }>;
  return keyAfterAll(rows.map((r) => r.sort_key));
}

export function createNode(worldId: string, viewer: Viewer, input: CreateNodeInput): NodeRow {
  const parentId = input.parentId ?? null;
  if (parentId !== null) {
    const parent = requireVisibleNode(parentId, viewer);
    if (parent.world_id !== worldId) throw badRequest("Parent belongs to a different world.");
  }

  const id = shortId();
  const title = input.title.trim().length > 0 ? input.title.trim() : "Untitled";
  const now = Date.now();
  const templateId = input.templateId ?? null;
  if (templateId !== null) assertTemplateInWorld(templateId, worldId);

  const row = transaction((): NodeRow => {
    insertNode.run({
      id,
      worldId,
      parentId,
      templateId,
      kind: input.kind ?? "document",
      title,
      slug: uniqueSlug(title, (s) => slugTaken.get(worldId, s) !== undefined),
      bodyMd: input.bodyMd ?? "",
      icon: input.icon ?? null,
      sortKey: nextSortKey(worldId, parentId, null),
      visibility: input.visibility ?? "members",
      createdBy: viewer.userId,
      now,
    });
    const created = selectNode.get(id) as NodeRow;
    reindexLinks(created);
    resettleLinksFor(created);
    reindexFts(created);
    if (templateId !== null) assignTemplateFields(id, worldId, templateId);
    return created;
  });

  return row;
}

export function updateNode(nodeId: string, viewer: Viewer, input: UpdateNodeInput): NodeRow {
  const existing = requireVisibleNode(nodeId, viewer);
  if (!canEditNode(existing, viewer)) {
    throw forbidden("You cannot edit this page.");
  }
  // A body edit is a wholesale replace (see input.bodyMd below), so a viewer who
  // cannot see the existing secret block would silently delete it by saving.
  // Reject rather than risk that — ask a DM to edit the body instead.
  if (input.bodyMd !== undefined && !canSeeSecrets(viewer.role) && containsSecret(existing.body_md)) {
    throw badRequest(
      "This page has a DM-only secret section. Only the owner or a DM can edit its body.",
    );
  }

  const title = input.title?.trim();
  const renaming = title !== undefined && title.length > 0 && title !== existing.title;
  const slug = renaming
    ? uniqueSlug(title, (s) => s !== existing.slug && slugTaken.get(existing.world_id, s) !== undefined)
    : existing.slug;

  const templateId = input.templateId !== undefined ? input.templateId : existing.template_id;
  const templateChanged = templateId !== null && templateId !== existing.template_id;
  if (templateChanged) assertTemplateInWorld(templateId, existing.world_id);

  return transaction((): NodeRow => {
    db.prepare(
      `UPDATE nodes SET title = ?, slug = ?, body_md = ?, icon = ?, visibility = ?,
                        template_id = ?, is_archived = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      renaming ? title : existing.title,
      slug,
      input.bodyMd ?? existing.body_md,
      input.icon !== undefined ? input.icon : existing.icon,
      input.visibility ?? existing.visibility,
      templateId,
      input.isArchived !== undefined ? (input.isArchived ? 1 : 0) : existing.is_archived,
      Date.now(),
      nodeId,
    );

    const updated = selectNode.get(nodeId) as NodeRow;
    if (input.bodyMd !== undefined) reindexLinks(updated);
    if (renaming) resettleLinksFor(updated);
    if (input.bodyMd !== undefined || renaming) reindexFts(updated);
    if (templateChanged) assignTemplateFields(nodeId, existing.world_id, templateId);
    return updated;
  });
}

/** True when `candidateParent` is `nodeId` itself or sits beneath it. */
function wouldCycle(nodeId: string, candidateParent: string | null): boolean {
  let current = candidateParent;
  const seen = new Set<string>();
  while (current !== null) {
    if (current === nodeId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = getNodeRow(current)?.parent_id ?? null;
  }
  return false;
}

export function moveNode(nodeId: string, viewer: Viewer, input: MoveNodeInput): NodeRow {
  const node = requireVisibleNode(nodeId, viewer);
  if (!canEditNode(node, viewer)) {
    throw forbidden("You cannot move this page.");
  }

  const parentId = input.parentId;
  if (parentId !== null) {
    const parent = requireVisibleNode(parentId, viewer);
    if (parent.world_id !== node.world_id) throw badRequest("Cannot move between worlds.");
  }
  if (wouldCycle(nodeId, parentId)) {
    throw badRequest("A page cannot be moved inside itself.");
  }

  const neighbourKey = (id: string | null | undefined): string | null => {
    if (id === null || id === undefined) return null;
    const sibling = getNodeRow(id);
    if (sibling === null) throw badRequest("Unknown sibling.");
    if (sibling.parent_id !== parentId) throw badRequest("Sibling is not under the target parent.");
    return sibling.sort_key;
  };

  const after = neighbourKey(input.afterId);
  const before = neighbourKey(input.beforeId);
  const sortKey =
    after === null && before === null
      ? nextSortKey(node.world_id, parentId, nodeId)
      : keyBetween(after, before);

  db.prepare("UPDATE nodes SET parent_id = ?, sort_key = ?, updated_at = ? WHERE id = ?").run(
    parentId,
    sortKey,
    Date.now(),
    nodeId,
  );
  return selectNode.get(nodeId) as NodeRow;
}

/**
 * One-time repair for links created before reindexLinks() stripped secret
 * blocks (see the comment on reindexLinks itself): re-derives every node's
 * `links` rows from its current body. Called once at boot, gated by the same
 * `_migrations` ledger the SQL migrations use, under a name that is not a
 * filename — this is a JS-driven data repair, not a schema change, so it does
 * not belong in migrations/*.sql (rule 6.4).
 */
export function backfillLinksStrippedOfSecrets(): void {
  const rows = db.prepare("SELECT * FROM nodes").all() as NodeRow[];
  transaction(() => {
    for (const row of rows) reindexLinks(row);
  });
}

/** Archive rather than delete; children go with it. */
export function archiveNode(nodeId: string, viewer: Viewer): void {
  const node = requireVisibleNode(nodeId, viewer);
  if (!canEditNode(node, viewer)) {
    throw forbidden("You cannot archive this page.");
  }
  db.prepare(
    `WITH RECURSIVE subtree(id) AS (
       SELECT ? UNION ALL SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id
     )
     UPDATE nodes SET is_archived = 1, updated_at = ? WHERE id IN (SELECT id FROM subtree)`,
  ).run(nodeId, Date.now());
}
