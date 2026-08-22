import type { AclEntryDto, GrantAclInput, Role } from "@dndworldapp/schema";
import { ROLES } from "@dndworldapp/schema";
import { db } from "../db/index.ts";
import type { NodeRow } from "../db/types.ts";
import { canEdit } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";

/**
 * Per-node ACL: additive grants on top of a node's own visibility — "this
 * specific person" or "anyone with this role" gets read or edit on one page.
 * See the comment on `nodeAclSql()` in auth/policy.ts for why this is
 * grant-only, with no deny.
 */

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", dm: "DM", player: "Player", guest: "Guest" };

const selectForNode = db.prepare(`
  SELECT a.*, u.username FROM acl a
  LEFT JOIN users u ON u.id = a.subject_id AND a.subject_type = 'user'
  WHERE a.node_id = ?
  ORDER BY a.created_at
`);
const findUserById = db.prepare("SELECT 1 FROM users WHERE id = ?");
const insertOrUpdate = db.prepare(`
  INSERT INTO acl (id, node_id, subject_type, subject_id, can_read, can_edit, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (node_id, subject_type, subject_id)
    DO UPDATE SET can_read = excluded.can_read, can_edit = excluded.can_edit
`);
const deleteEntry = db.prepare("DELETE FROM acl WHERE id = ? AND node_id = ?");
const aclGrantsEdit = db.prepare(`
  SELECT 1 FROM acl WHERE node_id = ? AND can_edit = 1 AND
    ((subject_type = 'user' AND subject_id = ?) OR (subject_type = 'role' AND subject_id = ?))
  LIMIT 1
`);

type AclRow = {
  id: string;
  node_id: string;
  subject_type: "user" | "role";
  subject_id: string;
  can_read: number;
  can_edit: number;
  created_by: string | null;
  created_at: number;
  username: string | null;
};

function toDto(row: AclRow): AclEntryDto {
  const subjectLabel =
    row.subject_type === "role"
      ? (ROLE_LABEL[row.subject_id as Role] ?? row.subject_id)
      : (row.username ?? "(deleted account)");
  return {
    id: row.id,
    nodeId: row.node_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    subjectLabel,
    canRead: row.can_read === 1,
    canEdit: row.can_edit === 1,
    createdAt: row.created_at,
  };
}

export function listAcl(nodeId: string): AclEntryDto[] {
  return (selectForNode.all(nodeId) as AclRow[]).map(toDto);
}

export function grantAcl(nodeId: string, viewer: Viewer, input: GrantAclInput): AclEntryDto {
  if (input.subjectType === "role") {
    if (!ROLES.includes(input.subjectId as Role)) {
      throw badRequest(`"${input.subjectId}" is not a role. Use one of: ${ROLES.join(", ")}.`);
    }
  } else if (findUserById.get(input.subjectId) === undefined) {
    throw badRequest("No account with that id.");
  }
  if (!input.canRead && !input.canEdit) {
    throw badRequest("Grant at least read or edit — an entry that grants neither does nothing.");
  }

  const id = shortId(12);
  insertOrUpdate.run(
    id,
    nodeId,
    input.subjectType,
    input.subjectId,
    input.canRead ? 1 : 0,
    input.canEdit ? 1 : 0,
    viewer.userId,
    Date.now(),
  );
  // The insert id is thrown away on conflict (upsert keeps the original row),
  // so re-read by the natural key rather than trust `id`.
  const row = db
    .prepare(
      "SELECT a.*, u.username FROM acl a LEFT JOIN users u ON u.id = a.subject_id AND a.subject_type = 'user' " +
        "WHERE a.node_id = ? AND a.subject_type = ? AND a.subject_id = ?",
    )
    .get(nodeId, input.subjectType, input.subjectId) as AclRow;
  return toDto(row);
}

export function revokeAcl(nodeId: string, aclId: string): void {
  if (Number(deleteEntry.run(aclId, nodeId).changes) === 0) throw notFound("No such access grant.");
}

/** Owners/DMs and the node's own creator already have canEdit(); this adds ACL. */
export function canEditNode(row: NodeRow, viewer: Viewer): boolean {
  if (canEdit(viewer.role, row.created_by, viewer.userId)) return true;
  if (viewer.userId === null && viewer.role === null) return false;
  return aclGrantsEdit.get(row.id, viewer.userId, viewer.role) !== undefined;
}
