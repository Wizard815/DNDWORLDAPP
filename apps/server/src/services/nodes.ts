import type {
  Backlink,
  CreateNodeInput,
  MoveNodeInput,
  NodeDetail,
  NodeKind,
  NodeSummary,
  SearchHit,
  TagDto,
  UnresolvedLink,
  UpdateNodeInput,
  Visibility,
} from "@dndworldapp/schema";
import { db, transaction } from "../db/index.ts";
import type { NodeRow } from "../db/types.ts";
import { isGameMaster, nodeAclSql, visibilitySqlFor } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { badRequest, forbidden, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { containsHiddenSecret, redactForViewer, stripSecrets } from "../lib/secrets.ts";
import { keyAfterAll, keyBetween } from "../lib/sortkey.ts";
import { slugify, uniqueSlug } from "../lib/slug.ts";
import { descendantTagIds, reindexTextTags, setManualTags, tagsFor, toTagDto } from "./tags.ts";
import type { TagRow } from "./tags.ts";
import { linkKey, parseWikilinks } from "../lib/wikilinks.ts";
import { canEditNode } from "./acl.ts";
import { removeMapFiles } from "./mapFiles.ts";
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
  // effective_*: the resolved level after inheritance, never the page's own
  // `visibility` column (which may just say 'inherit') — migration 0016.
  const vis = visibilitySqlFor(viewer.role, viewer.userId, `${prefix}effective_visibility`, `${prefix}effective_owner_id`);
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

export function rowToSummary(row: NodeRow & { child_count?: number; tags?: string | null }): NodeSummary {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    slug: row.slug,
    icon: row.icon,
    kind: row.kind,
    visibility: row.visibility,
    effectiveVisibility: row.effective_visibility,
    sortKey: row.sort_key,
    childCount: row.child_count ?? 0,
    isArchived: row.is_archived === 1,
    updatedAt: row.updated_at,
    // Only queries that select TAGS_SUBQUERY `AS tags` fill this in; elsewhere a summary just has none.
    tags: parseTagsColumn(row.tags),
  };
}

/**
 * The whole visible tree in one query. At campaign scale (thousands of nodes)
 * this is far cheaper than lazy-loading each level, and it lets the client do
 * instant filtering and quick-switching without another round trip.
 */
/** A page's tags as `id\x1ename\x1ecolor` records joined by \x1f — one subquery per row, cheaper than a join that multiplies rows. */
const TAGS_SUBQUERY = `(SELECT group_concat(t.id || char(30) || t.name || char(30) || coalesce(t.color, ''), char(31))
                        FROM node_tags nt JOIN tags t ON t.id = nt.tag_id WHERE nt.node_id = n.id)`;

function parseTagsColumn(raw: string | null | undefined): NodeSummary["tags"] {
  if (raw == null || raw.length === 0) return [];
  return raw.split("\u001f").map((rec) => {
    const [id, name, color] = rec.split("\u001e");
    return { id: id ?? "", name: name ?? "", color: (color !== undefined && color.length > 0 ? color : null) as NodeSummary["tags"][number]["color"] };
  });
}

export function getTree(worldId: string, viewer: Viewer): NodeSummary[] {
  const outer = readableSql("n", viewer);
  const inner = readableSql("c", viewer);

  const sql = `
    SELECT n.*,
           (SELECT COUNT(*) FROM nodes c
             WHERE c.parent_id = n.id AND c.is_archived = 0 AND ${inner.sql}) AS child_count,
           ${TAGS_SUBQUERY} AS tags
    FROM nodes n
    WHERE n.world_id = ? AND n.is_archived = 0 AND ${outer.sql}
    ORDER BY n.sort_key
  `;
  const rows = db.prepare(sql).all(...inner.params, worldId, ...outer.params) as Array<
    NodeRow & { child_count: number; tags: string | null }
  >;
  return rows.map(rowToSummary);
}

// ---------------------------------------------------------------------------
// Inherited visibility (migration 0016). A page's own `visibility` may be
// 'inherit'; what every read path compares against is effective_visibility
// (+ effective_owner_id for 'private'), kept current here.
// ---------------------------------------------------------------------------

function effectiveFor(row: NodeRow): { visibility: Visibility; ownerId: string | null } {
  if (row.visibility !== "inherit") return { visibility: row.visibility, ownerId: row.created_by };
  const parent = row.parent_id !== null ? getNodeRow(row.parent_id) : null;
  if (parent === null) return { visibility: "members", ownerId: null };
  return { visibility: parent.effective_visibility, ownerId: parent.effective_owner_id };
}

const updateEffective = db.prepare("UPDATE nodes SET effective_visibility = ?, effective_owner_id = ? WHERE id = ?");
const selectChildIds = db.prepare("SELECT id FROM nodes WHERE parent_id = ?");

/**
 * Re-resolves a page and everything under it, top down so each child reads
 * its parent's fresh value. Called after anything that can change the
 * answer: creation, a visibility change, a move, a restore.
 */
export function recomputeEffective(nodeId: string): void {
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const row = getNodeRow(id);
    if (row === null) continue;
    const next = effectiveFor(row);
    updateEffective.run(next.visibility, next.ownerId, id);
    for (const child of selectChildIds.all(id) as Array<{ id: string }>) queue.push(child.id);
  }
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
  // Archived/trashed pages are gone from everywhere a viewer looks (tree,
  // search, links), so a saved URL must not keep one readable either.
  return db.prepare(`SELECT 1 FROM nodes WHERE id = ? AND is_archived = 0 AND ${read.sql}`).get(nodeId, ...read.params) !== undefined;
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
    bodyMd: redactForViewer(row.body_md, viewer.role),
    templateId: row.template_id,
    breadcrumb: breadcrumbFor(row),
    children: children.map(rowToSummary),
    backlinks: backlinksFor(nodeId, viewer),
    tags: tagsFor(nodeId),
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

/**
 * "Mentioned in" — everywhere this node is wikilinked to, UNIONed with
 * everywhere it's used as a `#tag` (only ever non-empty when nodeId is
 * itself a tag node, but no special-casing needed: node_tags only ever
 * points at tag nodes in the first place, so the second half is naturally
 * empty for anything else). One combined query, one panel on the client.
 */
export function backlinksFor(nodeId: string, viewer: Viewer): Backlink[] {
  const vis = readableSql("n", viewer);
  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.icon, l.label
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
 * Pages carrying a tag (and, by default, any tag nested under it), filtered
 * by what the viewer may see. Lives here rather than in tags.ts because it
 * needs readableSql/rowToSummary.
 */
export function pagesForTag(tagId: string, viewer: Viewer, includeChildren = true): NodeSummary[] {
  const ids = includeChildren ? [tagId, ...descendantTagIds(tagId)] : [tagId];
  const outer = readableSql("n", viewer);
  const inner = readableSql("c", viewer);
  const rows = db
    .prepare(
      `SELECT n.*,
              (SELECT COUNT(*) FROM nodes c WHERE c.parent_id = n.id AND c.is_archived = 0 AND ${inner.sql}) AS child_count,
              ${TAGS_SUBQUERY} AS tags
       FROM nodes n
       WHERE n.id IN (SELECT node_id FROM node_tags WHERE tag_id IN (${ids.map(() => "?").join(", ")}))
         AND n.is_archived = 0 AND ${outer.sql}
       ORDER BY n.title COLLATE NOCASE`,
    )
    .all(...inner.params, ...ids, ...outer.params) as Array<NodeRow & { child_count: number; tags: string | null }>;
  return rows.map(rowToSummary);
}

/** Every tag in the world with how many visible, live pages carry it directly. */
export function listTagsWithCounts(worldId: string, viewer: Viewer): TagDto[] {
  const vis = readableSql("n", viewer);
  const rows = db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM node_tags nt JOIN nodes n ON n.id = nt.node_id
                WHERE nt.tag_id = t.id AND n.is_archived = 0 AND ${vis.sql}) AS page_count
       FROM tags t WHERE t.world_id = ? ORDER BY t.name`,
    )
    .all(...vis.params, worldId) as Array<TagRow & { page_count: number }>;
  return rows.map((r) => toTagDto(r, r.page_count));
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
      visibility: input.visibility ?? "inherit",
      createdBy: viewer.userId,
      now,
    });
    recomputeEffective(id);
    const created = selectNode.get(id) as NodeRow;
    reindexLinks(created);
    resettleLinksFor(created);
    reindexTextTags(created);
    if (input.tags !== undefined) setManualTags(created, input.tags);
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
  if (input.bodyMd !== undefined && containsHiddenSecret(existing.body_md, viewer.role)) {
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

    if (input.visibility !== undefined && input.visibility !== existing.visibility) recomputeEffective(nodeId);
    const updated = selectNode.get(nodeId) as NodeRow;
    if (input.tags !== undefined) setManualTags(updated, input.tags);
    if (input.bodyMd !== undefined) {
      reindexLinks(updated);
      reindexTextTags(updated);
    }
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
  // Under a new parent, an inherited level may now resolve differently.
  recomputeEffective(nodeId);
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

// ---------------------------------------------------------------------------
// Removal (migration 0015). Two ways out, both recoverable:
//   archive — kept indefinitely, for "done with this but keep it";
//   trash   — kept 30 days, then purged for good.
// Both set is_archived so every existing "is_archived = 0" filter hides them.
// ---------------------------------------------------------------------------

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const SUBTREE_CTE = `WITH RECURSIVE subtree(id) AS (
  SELECT ? UNION ALL SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id
)`;

/**
 * A removed page is not a link target any more: every wikilink pointing into
 * the subtree goes back to "wanted" (dst NULL), so it shows under Wanted
 * pages instead of rendering as a working link to a 404. Restore re-resolves
 * them by title/slug the same way a rename does (resettleLinksFor).
 */
const unlinkSubtree = db.prepare(`${SUBTREE_CTE} UPDATE links SET dst_node_id = NULL WHERE dst_node_id IN (SELECT id FROM subtree)`);
const selectSubtreeRows = db.prepare(`${SUBTREE_CTE} SELECT * FROM nodes WHERE id IN (SELECT id FROM subtree)`);

/** A page that was archived or trashed, as the DM's "Archived & Trash" panel lists it. */
export interface RemovedNode {
  id: string;
  title: string;
  icon: string | null;
  kind: NodeKind;
  parentId: string | null;
  parentTitle: string | null;
  /** Pages inside it that go with it on restore. */
  childCount: number;
  /** When it was archived or trashed (updated_at at the time). */
  removedAt: number;
  /** Set only for trash: when it was trashed, so the panel can say when it purges. */
  deletedAt: number | null;
}

/** The page being removed must be one this viewer could see and edit — not a probe at hidden ids. */
function requireRemovable(nodeId: string, viewer: Viewer, action: string): NodeRow {
  const node = requireVisibleNode(nodeId, viewer);
  if (!canEditNode(node, viewer)) throw forbidden(`You cannot ${action} this page.`);
  return node;
}

/** Archive rather than delete; children go with it. */
export function archiveNode(nodeId: string, viewer: Viewer): void {
  requireRemovable(nodeId, viewer, "archive");
  transaction(() => {
    db.prepare(`${SUBTREE_CTE} UPDATE nodes SET is_archived = 1, updated_at = ? WHERE id IN (SELECT id FROM subtree)`).run(
      nodeId,
      Date.now(),
    );
    unlinkSubtree.run(nodeId);
  });
}

/** Move to the trash, from live or from the archive. Purged after TRASH_RETENTION_MS. */
export function trashNode(nodeId: string, viewer: Viewer): void {
  const node = getNodeRow(nodeId);
  if (node === null) throw notFound("No such node.");
  if (node.is_archived === 0) requireRemovable(nodeId, viewer, "delete");
  else if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can delete archived pages.");
  const now = Date.now();
  transaction(() => {
    db.prepare(
      `${SUBTREE_CTE} UPDATE nodes SET is_archived = 1, deleted_at = ?, updated_at = ? WHERE id IN (SELECT id FROM subtree)`,
    ).run(nodeId, now, now);
    unlinkSubtree.run(nodeId);
  });
}

/**
 * Bring an archived or trashed page (and everything inside it) back. If its
 * parent is itself still removed, the page comes back as a top-level page
 * rather than inside something invisible.
 */
export function restoreNode(nodeId: string, viewer: Viewer): void {
  const node = getNodeRow(nodeId);
  if (node === null || node.is_archived === 0) throw notFound("No such removed page.");
  if (!isGameMaster(viewer.role) && !canEditNode(node, viewer)) throw forbidden("You cannot restore this page.");
  const parent = node.parent_id !== null ? getNodeRow(node.parent_id) : null;
  const now = Date.now();
  transaction(() => {
    db.prepare(
      `${SUBTREE_CTE} UPDATE nodes SET is_archived = 0, deleted_at = NULL, updated_at = ? WHERE id IN (SELECT id FROM subtree)`,
    ).run(nodeId, now);
    if (parent !== null && parent.is_archived === 1) {
      db.prepare("UPDATE nodes SET parent_id = NULL, sort_key = ? WHERE id = ?").run(keyAfterLastRoot(node.world_id), nodeId);
    }
    recomputeEffective(nodeId);
    for (const row of selectSubtreeRows.all(nodeId) as NodeRow[]) resettleLinksFor(row);
  });
}

function keyAfterLastRoot(worldId: string): string {
  const last = db
    .prepare("SELECT sort_key FROM nodes WHERE world_id = ? AND parent_id IS NULL ORDER BY sort_key DESC LIMIT 1")
    .get(worldId) as { sort_key: string } | undefined;
  return keyBetween(last?.sort_key ?? null, null);
}

/** Hard delete. Only from the trash, only the owner/DM — the one thing here that cannot be undone. */
export function deleteNodeForever(nodeId: string, viewer: Viewer): void {
  const node = getNodeRow(nodeId);
  if (node === null || node.deleted_at === null) throw notFound("No such page in the trash.");
  if (!isGameMaster(viewer.role)) throw forbidden("Only the owner or a DM can delete a page for good.");
  hardDelete(nodeId);
}

/**
 * Children, tags, markers, posts, fields, ACL and share links all go by FK
 * cascade (foreign_keys is ON). Inbound links are detached first rather than
 * cascaded away, so the pages that mention this one keep their link as a
 * "wanted" one. Map files on disk are not in the database, so they're
 * removed by hand — after the rows, so a crash in between leaves orphan
 * files rather than a map row with no tiles.
 */
function hardDelete(nodeId: string): void {
  const mapIds = (selectSubtreeRows.all(nodeId) as NodeRow[]).filter((r) => r.kind === "map").map((r) => r.id);
  transaction(() => {
    unlinkSubtree.run(nodeId);
    db.prepare("DELETE FROM nodes WHERE id = ?").run(nodeId);
  });
  for (const id of mapIds) removeMapFiles(id);
}

/** Empties everything that has sat in the trash longer than the retention window. Returns how many rows went. */
export function purgeTrash(now = Date.now()): number {
  const rows = db
    .prepare("SELECT id FROM nodes WHERE deleted_at IS NOT NULL AND deleted_at < ?")
    .all(now - TRASH_RETENTION_MS) as Array<{ id: string }>;
  for (const row of rows) {
    // A child may already be gone via its parent's cascade — that's fine.
    hardDelete(row.id);
  }
  return rows.length;
}

/**
 * What the DM's panel shows: the top of each removed subtree only (a page
 * whose parent is removed the same way goes with it on restore). Trashed
 * pages inside an archived-but-not-trashed parent still show up in Trash.
 */
export function listRemoved(worldId: string): { archived: RemovedNode[]; trashed: RemovedNode[] } {
  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.icon, n.kind, n.parent_id, n.updated_at, n.deleted_at,
              p.title AS parent_title,
              (SELECT COUNT(*) FROM nodes c WHERE c.parent_id = n.id) AS child_count
       FROM nodes n LEFT JOIN nodes p ON p.id = n.parent_id
       WHERE n.world_id = ? AND n.is_archived = 1
         AND (p.id IS NULL OR p.is_archived = 0 OR (n.deleted_at IS NOT NULL AND p.deleted_at IS NULL))
       ORDER BY n.updated_at DESC`,
    )
    .all(worldId) as Array<{
    id: string;
    title: string;
    icon: string | null;
    kind: NodeKind;
    parent_id: string | null;
    updated_at: number;
    deleted_at: number | null;
    parent_title: string | null;
    child_count: number;
  }>;
  const toDto = (r: (typeof rows)[number]): RemovedNode => ({
    id: r.id,
    title: r.title,
    icon: r.icon,
    kind: r.kind,
    parentId: r.parent_id,
    parentTitle: r.parent_title,
    childCount: r.child_count,
    removedAt: r.updated_at,
    deletedAt: r.deleted_at,
  });
  return {
    archived: rows.filter((r) => r.deleted_at === null).map(toDto),
    trashed: rows.filter((r) => r.deleted_at !== null).map(toDto),
  };
}
