import { createHash, randomBytes } from "node:crypto";
import type { NodeDetail, NodeSummary, ShareLinkDto } from "@dndworldapp/schema";
import { canSeeSecrets, nodeAclSql, visibilitySqlFor } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import type { NodeRow } from "../db/types.ts";
import { notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";
import { redactForViewer } from "../lib/secrets.ts";
import { breadcrumbFor, getNodeRow, rowToSummary } from "./nodes.ts";

/**
 * Anonymous share links: the second guest mechanism (docs/PLAN.md §5) — an
 * owner/DM hands out a URL, no account needed. A link grants read access to
 * the node it was made on *regardless of that node's own visibility*
 * (sharing a `members`- or `dm`-visibility page is the whole point), and to
 * its subtree under the normal rules a `guest` gets everywhere else
 * (`public`, or an explicit guest-role ACL grant) — so sharing one page never
 * silently exposes whatever DM-only content happens to live underneath it.
 *
 * Modelled on auth/tokens.ts, not on acl.ts: this row identifies a link, not
 * a person or role, so only its sha256 is stored and the plaintext token is
 * returned once, at creation.
 */

const GUEST: Viewer = { userId: null, role: "guest" };
const PREFIX_LEN = 10;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type ShareLinkRow = {
  id: string;
  node_id: string;
  hash: string;
  prefix: string;
  created_by: string | null;
  created_at: number;
  revoked_at: number | null;
};

const insertLink = db.prepare(`
  INSERT INTO share_links (id, node_id, hash, prefix, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const selectById = db.prepare("SELECT * FROM share_links WHERE id = ?");
const selectByHash = db.prepare("SELECT * FROM share_links WHERE hash = ?");
const selectForNode = db.prepare("SELECT * FROM share_links WHERE node_id = ? ORDER BY created_at DESC");
const revokeStmt = db.prepare(
  "UPDATE share_links SET revoked_at = ? WHERE id = ? AND node_id = ? AND revoked_at IS NULL",
);

function toDto(row: ShareLinkRow): ShareLinkDto {
  return {
    id: row.id,
    nodeId: row.node_id,
    prefix: row.prefix,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export function listShareLinks(nodeId: string): ShareLinkDto[] {
  return (selectForNode.all(nodeId) as ShareLinkRow[]).map(toDto);
}

export function createShareLink(nodeId: string, viewer: Viewer): { shareLink: ShareLinkDto; token: string } {
  const token = randomBytes(24).toString("hex");
  const id = shortId(12);
  insertLink.run(id, nodeId, hashToken(token), token.slice(0, PREFIX_LEN), viewer.userId, Date.now());
  return { shareLink: toDto(selectById.get(id) as ShareLinkRow), token };
}

export function revokeShareLink(nodeId: string, id: string): void {
  if (Number(revokeStmt.run(Date.now(), id, nodeId).changes) === 0) {
    throw notFound("No such share link.");
  }
}

function resolveShareRoot(token: string): NodeRow | null {
  const row = selectByHash.get(hashToken(token)) as ShareLinkRow | undefined;
  if (row === undefined || row.revoked_at !== null) return null;
  const node = getNodeRow(row.node_id);
  if (node === null || node.is_archived === 1) return null;
  return node;
}

/** `alias`-qualified "a guest could read this row" — public, or a guest-role ACL grant. */
function guestReadableSql(alias: string): { sql: string; params: Array<string | null> } {
  const prefix = `${alias}.`;
  const vis = visibilitySqlFor(GUEST.role, GUEST.userId, `${prefix}visibility`, `${prefix}created_by`);
  const acl = nodeAclSql(`${prefix}id`, GUEST.role, GUEST.userId, "read");
  return { sql: `(${vis.sql} OR ${acl.sql})`, params: [...vis.params, ...acl.params] };
}

interface ShareScope {
  root: NodeRow;
  nodes: NodeSummary[];
}

/**
 * The shared subtree, as a flat list. The root is always included — sharing
 * it is the DM's explicit act — descendants only if a guest could see them
 * on their own merits. Mirrors getTree() in services/nodes.ts, scoped to one
 * root via a recursive CTE instead of the whole world.
 */
function getShareScope(token: string): ShareScope | null {
  const root = resolveShareRoot(token);
  if (root === null) return null;

  const inner = guestReadableSql("c");
  const outer = guestReadableSql("n");
  const rows = db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT ?
         UNION ALL
         SELECT n.id FROM nodes n JOIN subtree s ON n.parent_id = s.id WHERE n.is_archived = 0
       )
       SELECT n.*,
              (SELECT COUNT(*) FROM nodes c
                WHERE c.parent_id = n.id AND c.is_archived = 0 AND ${inner.sql}) AS child_count
       FROM nodes n
       WHERE n.id IN (SELECT id FROM subtree) AND n.is_archived = 0 AND (n.id = ? OR ${outer.sql})
       ORDER BY n.sort_key`,
    )
    // Positional `?` binding — must match the SQL text's left-to-right order
    // exactly: the CTE seed first, then the child_count subquery's params,
    // then the root-exception check, then the outer visibility/ACL params.
    .all(root.id, ...inner.params, root.id, ...outer.params) as Array<NodeRow & { child_count: number }>;

  return { root, nodes: rows.map(rowToSummary) };
}

/** The shared subtree, for the share view's page list. Null for an unknown or revoked token. */
export function getSharedTree(token: string): { rootId: string; nodes: NodeSummary[] } | null {
  const scope = getShareScope(token);
  if (scope === null) return null;
  return { rootId: scope.root.id, nodes: scope.nodes };
}

/**
 * One page within a share's subtree. Null when the token is unknown/revoked,
 * or when nodeId is not inside this particular share's scope — the same
 * "not found" either way, so a guest cannot use a valid token to probe for
 * node ids outside what was actually shared.
 */
export function getSharedNode(token: string, nodeId: string): NodeDetail | null {
  const scope = getShareScope(token);
  if (scope === null) return null;
  const summary = scope.nodes.find((n) => n.id === nodeId);
  if (summary === undefined) return null;

  const row = getNodeRow(nodeId);
  if (row === null) return null;

  // Trimmed to start at the shared root — ancestors above that sit outside
  // the share and must not leak, not even just their titles.
  const fullBreadcrumb = breadcrumbFor(row);
  const rootIndex = fullBreadcrumb.findIndex((a) => a.id === scope.root.id);
  const breadcrumb = rootIndex === -1 ? [] : fullBreadcrumb.slice(rootIndex);

  return {
    ...summary,
    worldId: row.world_id,
    bodyMd: redactForViewer(row.body_md, canSeeSecrets(GUEST.role)),
    templateId: row.template_id,
    breadcrumb,
    children: scope.nodes.filter((n) => n.parentId === nodeId),
    // Backlinks can point at nodes outside the shared scope; omit rather than
    // risk leaking a title through them.
    backlinks: [],
    canEdit: false,
  };
}
