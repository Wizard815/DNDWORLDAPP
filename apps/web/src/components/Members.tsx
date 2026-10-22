import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { MemberDto, Role } from "@dndworldapp/schema";
import { ApiError, api } from "../api.ts";
import { useEscapeKey } from "../lib/useEscapeKey.ts";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  dm: "DM",
  player: "Player",
  guest: "Guest",
};

/**
 * The DM's account admin panel. There is no self-service signup and no email
 * anywhere in this app — a DM adds someone here, either attaching an existing
 * account to this world or creating a brand-new one for them on the spot, and
 * resets a forgotten password the same way. Read access is open to any member
 * (seeing who is in the world is not sensitive); the mutating actions are
 * hidden — and separately enforced server-side — for anyone who is not an
 * owner or DM.
 */
export function Members({
  worldId,
  canManage,
  onClose,
}: {
  worldId: string;
  canManage: boolean;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["members", worldId],
    queryFn: () => api.members(worldId),
  });

  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("player");
  const [newAccount, setNewAccount] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["members", worldId] });

  const add = useMutation({
    mutationFn: () =>
      api.addMember(worldId, {
        username: username.trim(),
        role,
        name: newAccount ? name.trim() : undefined,
        password: newAccount ? password : undefined,
      }),
    onSuccess: () => {
      setUsername("");
      setName("");
      setPassword("");
      setNewAccount(false);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not add them."),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(worldId, userId),
    onSuccess: invalidate,
  });

  const members = data?.members ?? [];

  return (
    <div className="modal-backdrop pt-[8vh]" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center">
          <h2 className="text-base font-semibold text-fg-strong">Members</h2>
          <button type="button" onClick={onClose} className="ml-auto text-sm text-fg-muted hover:text-fg">
            Close
          </button>
        </div>
        <p className="mb-5 text-xs text-fg-subtle">
          No email in this app — accounts are created here, by a DM, with a username and
          a password you choose for them.
        </p>

        {canManage && (
          <form
            className="mb-6 space-y-3 rounded-md border border-selected p-4"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <div className="flex gap-2">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                required
                className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-line-strong"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="rounded-md border border-line bg-canvas px-2 py-2 text-sm"
              >
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-soft">
              <input type="checkbox" checked={newAccount} onChange={(e) => setNewAccount(e.target.checked)} />
              They do not have an account yet — create one
            </label>

            {newAccount && (
              <div className="flex gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Their name"
                  required={newAccount}
                  className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-line-strong"
                />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="text"
                  placeholder="Password"
                  required={newAccount}
                  className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-line-strong"
                />
              </div>
            )}

            {error !== null && <p className="text-xs text-danger">{error}</p>}

            <button
              type="submit"
              disabled={add.isPending || username.trim().length === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              {add.isPending ? "Adding…" : newAccount ? "Create account and add" : "Add"}
            </button>
          </form>
        )}

        <ul className="space-y-2">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              canManage={canManage}
              resetting={resettingId === member.id}
              onStartReset={() => setResettingId(member.id)}
              onCancelReset={() => setResettingId(null)}
              onReset={async (newPassword) => {
                await api.resetMemberPassword(worldId, member.id, newPassword);
                setResettingId(null);
              }}
              onRemove={() => remove.mutate(member.id)}
            />
          ))}
          {members.length === 0 && <p className="text-xs text-fg-faint">No members yet.</p>}
        </ul>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  resetting,
  onStartReset,
  onCancelReset,
  onReset,
  onRemove,
}: {
  member: MemberDto;
  canManage: boolean;
  resetting: boolean;
  onStartReset: () => void;
  onCancelReset: () => void;
  onReset: (newPassword: string) => Promise<void>;
  onRemove: () => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="rounded-md border border-selected px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-fg">{member.name}</span>
            <code className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
              {member.username}
            </code>
          </div>
          <div className="text-[11px] text-fg-muted">{ROLE_LABEL[member.role]}</div>
        </div>
        {canManage && (
          <>
            <button
              type="button"
              onClick={resetting ? onCancelReset : onStartReset}
              className="text-xs text-fg-muted hover:text-fg"
            >
              {resetting ? "Cancel" : "Reset password"}
            </button>
            {member.role !== "owner" && (
              <button type="button" onClick={onRemove} className="text-xs text-fg-muted hover:text-danger">
                Remove
              </button>
            )}
          </>
        )}
      </div>

      {resetting && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            onReset(newPassword).catch((err) =>
              setError(err instanceof ApiError ? err.message : "Could not reset it."),
            );
          }}
        >
          <input
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            required
            className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1.5 text-xs outline-none focus:border-line-strong"
          />
          <button type="submit" className="rounded bg-accent px-2 py-1.5 text-xs text-on-accent hover:bg-accent-hover">
            Set
          </button>
          {error !== null && <span className="self-center text-xs text-danger">{error}</span>}
        </form>
      )}
    </li>
  );
}
