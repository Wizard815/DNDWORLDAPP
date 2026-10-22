import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AclEntryDto, Role, ShareLinkDto } from "@dndworldapp/schema";
import { ApiError, api } from "../api.ts";
import { useEscapeKey } from "../lib/useEscapeKey.ts";

/** Only these are meaningful to grant — owner/dm already see and edit everything. */
const GRANTABLE_ROLES: Role[] = ["player", "guest"];
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", dm: "DM", player: "Player", guest: "Guest" };

/**
 * Per-page access grants — additive only, on top of the page's own visibility.
 * "Anyone with this role" (subjectType 'role') is how "anyone can edit this
 * page" is expressed without touching visibility for everyone else; "this one
 * person" (subjectType 'user') is the one-off exception. There is no deny: a
 * grant can only widen what a viewer could already do here, never narrow it.
 */
export function Access({
  nodeId,
  worldId,
  nodeTitle,
  onClose,
}: {
  nodeId: string;
  worldId: string;
  nodeTitle: string;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["acl", nodeId], queryFn: () => api.acl(nodeId) });
  const { data: membersData } = useQuery({
    queryKey: ["members", worldId],
    queryFn: () => api.members(worldId),
  });

  const [subjectType, setSubjectType] = useState<"user" | "role">("role");
  const [subjectId, setSubjectId] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canEditGrant, setCanEditGrant] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["acl", nodeId] });

  const grant = useMutation({
    mutationFn: () => api.grantAcl(nodeId, { subjectType, subjectId, canRead, canEdit: canEditGrant }),
    onSuccess: () => {
      setSubjectId("");
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not grant access."),
  });

  const revoke = useMutation({
    mutationFn: (aclId: string) => api.revokeAcl(nodeId, aclId),
    onSuccess: invalidate,
  });

  const entries = data?.entries ?? [];
  const members = membersData?.members ?? [];

  return (
    <div className="modal-backdrop pt-[8vh]" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center">
          <h2 className="min-w-0 truncate text-base font-semibold text-fg-strong">
            Access — {nodeTitle}
          </h2>
          <button type="button" onClick={onClose} className="ml-auto shrink-0 text-sm text-fg-muted hover:text-fg">
            Close
          </button>
        </div>
        <p className="mb-5 text-xs text-fg-subtle">
          Grants only ever add to what this page's visibility already allows — there is no
          way to take access away from here. To hide the page from someone entirely, change
          its visibility instead.
        </p>

        <form
          className="mb-6 space-y-3 rounded-md border border-selected p-4"
          onSubmit={(e) => {
            e.preventDefault();
            grant.mutate();
          }}
        >
          <div className="flex gap-2">
            <select
              value={subjectType}
              onChange={(e) => {
                setSubjectType(e.target.value as "user" | "role");
                setSubjectId("");
              }}
              className="rounded-md border border-line bg-canvas px-2 py-2 text-sm"
            >
              <option value="role">Anyone with role…</option>
              <option value="user">This person…</option>
            </select>

            {subjectType === "role" ? (
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                required
                className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-2 text-sm"
              >
                <option value="" disabled>
                  Choose a role
                </option>
                {GRANTABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                required
                className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-2 text-sm"
              >
                <option value="" disabled>
                  Choose a member
                </option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.username})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-soft">
              <input type="checkbox" checked={canRead} onChange={(e) => setCanRead(e.target.checked)} />
              Can read
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-soft">
              <input
                type="checkbox"
                checked={canEditGrant}
                onChange={(e) => setCanEditGrant(e.target.checked)}
              />
              Can edit
            </label>
          </div>

          {error !== null && <p className="text-xs text-danger">{error}</p>}

          <button
            type="submit"
            disabled={grant.isPending || subjectId.length === 0 || (!canRead && !canEditGrant)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {grant.isPending ? "Granting…" : "Grant access"}
          </button>
        </form>

        <ul className="space-y-2">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onRevoke={() => revoke.mutate(entry.id)} />
          ))}
          {entries.length === 0 && <p className="text-xs text-fg-faint">No extra grants on this page.</p>}
        </ul>

        <ShareLinksSection nodeId={nodeId} />
      </div>
    </div>
  );
}

/**
 * Anonymous share links — the no-account guest mechanism. A link reveals this
 * page and its subtree to anyone holding the URL, no sign-in required, so the
 * token is shown once at creation and never again (the server keeps only its
 * hash, like an API token).
 */
function ShareLinksSection({ nodeId }: { nodeId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["share-links", nodeId],
    queryFn: () => api.shareLinks(nodeId),
  });
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["share-links", nodeId] });

  const create = useMutation({
    mutationFn: () => api.createShareLink(nodeId),
    onSuccess: (result) => {
      setFreshUrl(`${window.location.origin}/share/${result.token}`);
      setCopied(false);
      invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeShareLink(nodeId, id),
    onSuccess: invalidate,
  });

  const links = (data?.shareLinks ?? []).filter((l) => l.revokedAt === null);

  return (
    <div className="mt-6 border-t border-selected pt-5">
      <h3 className="mb-1 text-sm font-semibold text-fg">Share links</h3>
      <p className="mb-3 text-xs text-fg-subtle">
        Anyone with the link can view this page and its subtree — no account needed. Reveals
        this page even if its visibility is normally members- or DM-only; pages underneath it
        still follow their own visibility.
      </p>

      {freshUrl !== null && (
        <div className="mb-3 rounded-md border border-accent bg-accent-soft p-3">
          <p className="mb-2 text-xs text-fg-soft">
            Copy this now — it will not be shown again.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={freshUrl}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-xs text-fg"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(freshUrl).then(() => setCopied(true));
              }}
              className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-xs text-on-accent hover:bg-accent-hover"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => create.mutate()}
        disabled={create.isPending}
        className="mb-3 rounded-md border border-line px-3 py-1.5 text-sm text-fg hover:bg-press disabled:opacity-50"
      >
        {create.isPending ? "Creating…" : "Create a share link"}
      </button>

      <ul className="space-y-2">
        {links.map((link) => (
          <ShareLinkRow key={link.id} link={link} onRevoke={() => revoke.mutate(link.id)} />
        ))}
        {links.length === 0 && freshUrl === null && (
          <p className="text-xs text-fg-faint">No active share links on this page.</p>
        )}
      </ul>
    </div>
  );
}

function ShareLinkRow({ link, onRevoke }: { link: ShareLinkDto; onRevoke: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-selected px-3 py-2">
      <div className="min-w-0 flex-1">
        <code className="font-mono text-xs text-fg">{link.prefix}…</code>
        <div className="text-[11px] text-fg-muted">
          Created {new Date(link.createdAt).toLocaleDateString()}
        </div>
      </div>
      <button type="button" onClick={onRevoke} className="text-xs text-fg-muted hover:text-danger">
        Revoke
      </button>
    </li>
  );
}

function EntryRow({ entry, onRevoke }: { entry: AclEntryDto; onRevoke: () => void }) {
  const rights = [entry.canRead ? "read" : null, entry.canEdit ? "edit" : null].filter(Boolean).join(" + ");
  return (
    <li className="flex items-center gap-3 rounded-md border border-selected px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm text-fg">
          <span className="truncate">{entry.subjectLabel}</span>
          <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
            {entry.subjectType === "role" ? "role" : "person"}
          </code>
        </div>
        <div className="text-[11px] text-fg-muted">{rights || "no rights"}</div>
      </div>
      <button type="button" onClick={onRevoke} className="text-xs text-fg-muted hover:text-danger">
        Revoke
      </button>
    </li>
  );
}
