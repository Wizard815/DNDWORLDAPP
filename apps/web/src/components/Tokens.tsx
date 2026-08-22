import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Scope, TokenDto } from "@dndworldapp/schema";
import { api } from "../api.ts";

const SCOPE_LABEL: Record<Scope, string> = {
  "world:read": "Read",
  "world:write": "Read + write",
  admin: "Admin (accounts, membership)",
};

const SCOPE_HELP: Record<Scope, string> = {
  "world:read": "Fetch pages, search, read posts.",
  "world:write": "Everything read can do, plus creating and editing.",
  admin: "Also manage accounts and who is in the world. Grant sparingly.",
};

function when(ms: number | null): string {
  if (ms === null) return "never";
  return new Date(ms).toLocaleString();
}

export function Tokens({
  worldId,
  worldName,
  onClose,
}: {
  worldId: string;
  worldName: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["tokens"], queryFn: () => api.tokens() });

  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("world:read");
  const [pinned, setPinned] = useState(true);
  const [expires, setExpires] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.createToken({
        name: name.trim(),
        worldId: pinned ? worldId : null,
        scopes: [scope],
        expiresInDays: expires.trim().length > 0 ? Number(expires) : null,
      }),
    onSuccess: (result) => {
      setSecret(result.secret);
      setName("");
      setCopied(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tokens"] }),
  });

  const tokens = data?.tokens ?? [];
  const live = tokens.filter((t) => t.revokedAt === null);
  const dead = tokens.filter((t) => t.revokedAt !== null);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[8vh]" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#33363d] bg-[#1d1f23] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center">
          <h2 className="text-base font-semibold text-[#f0f1f4]">API tokens</h2>
          <button type="button" onClick={onClose} className="ml-auto text-sm text-[#7a7d86] hover:text-[#d7d8dc]">
            Close
          </button>
        </div>
        <p className="mb-5 text-xs text-[#8d9099]">
          For scripts and the MCP server. A token acts as you and inherits your role — scopes
          only ever narrow that. The secret is shown once.
        </p>

        {secret !== null && (
          <div className="mb-5 rounded-md border border-[#4a4222] bg-[#221f14] p-3">
            <p className="mb-2 text-xs text-[#c9a227]">
              Copy this now. It will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-[#15161a] px-2 py-1.5 font-mono text-xs text-[#d7d8dc]">
                {secret}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(secret).then(() => setCopied(true));
                }}
                className="rounded border border-[#5c5023] px-2 py-1.5 text-xs text-[#c9a227] hover:bg-[#2a2517]"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setSecret(null)}
                className="text-xs text-[#7a7d86] hover:text-[#d7d8dc]"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <form
          className="mb-6 space-y-3 rounded-md border border-[#2c2f36] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What is it for? e.g. MCP server"
            required
            className="w-full rounded-md border border-[#33363d] bg-[#17181b] px-3 py-2 text-sm outline-none focus:border-[#4a4d55]"
          />

          <div className="space-y-1">
            {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
              <label key={s} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === s}
                  onChange={() => setScope(s)}
                  className="mt-1"
                />
                <span>
                  <span className={s === "admin" ? "text-[#c9a227]" : "text-[#d7d8dc]"}>
                    {SCOPE_LABEL[s]}
                  </span>
                  <span className="block text-xs text-[#7a7d86]">{SCOPE_HELP[s]}</span>
                </span>
              </label>
            ))}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#b6b8bf]">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Limit to <span className="text-[#d7d8dc]">{worldName}</span> only
          </label>

          <label className="flex items-center gap-2 text-sm text-[#b6b8bf]">
            Expires in
            <input
              value={expires}
              onChange={(e) => setExpires(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="never"
              className="w-20 rounded border border-[#33363d] bg-[#17181b] px-2 py-1 text-sm outline-none focus:border-[#4a4d55]"
            />
            days
          </label>

          {error !== null && <p className="text-xs text-[#e0888a]">{error}</p>}

          <button
            type="submit"
            disabled={create.isPending || name.trim().length === 0}
            className="rounded-md bg-[#3d5ab5] px-3 py-1.5 text-sm text-white hover:bg-[#4867cc] disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create token"}
          </button>
        </form>

        <TokenList tokens={live} title="Active" onRevoke={(id) => revoke.mutate(id)} />
        {dead.length > 0 && <TokenList tokens={dead} title="Revoked" onRevoke={null} />}
      </div>
    </div>
  );
}

function TokenList({
  tokens,
  title,
  onRevoke,
}: {
  tokens: TokenDto[];
  title: string;
  onRevoke: ((id: string) => void) | null;
}) {
  if (tokens.length === 0) {
    return (
      <>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">{title}</h3>
        <p className="mb-4 text-xs text-[#6b6e77]">None yet.</p>
      </>
    );
  }

  return (
    <>
      <h3 className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-[#7a7d86]">
        {title}
      </h3>
      <ul className="space-y-2">
        {tokens.map((token) => (
          <li
            key={token.id}
            className={`flex items-center gap-3 rounded-md border border-[#2c2f36] px-3 py-2 ${
              onRevoke === null ? "opacity-50" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-[#d7d8dc]">{token.name}</span>
                <code className="rounded bg-[#17181b] px-1.5 py-0.5 font-mono text-[10px] text-[#7a7d86]">
                  {token.prefix}…
                </code>
              </div>
              <div className="text-[11px] text-[#7a7d86]">
                {token.scopes.join(", ")}
                {token.worldId === null ? " · all worlds" : " · one world"}
                {" · last used "}
                {when(token.lastUsedAt)}
                {token.expiresAt !== null && ` · expires ${when(token.expiresAt)}`}
              </div>
            </div>
            {onRevoke !== null && (
              <button
                type="button"
                onClick={() => onRevoke(token.id)}
                className="text-xs text-[#7a7d86] hover:text-[#e0888a]"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
