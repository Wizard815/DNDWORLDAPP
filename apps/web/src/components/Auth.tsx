import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api.ts";

const inputClass =
  "w-full rounded-md bg-[#1d1f23] border border-[#33363d] px-3 py-2 text-sm outline-none focus:border-[#6b7280]";
const buttonClass =
  "w-full rounded-md bg-[#3d5ab5] px-3 py-2 text-sm font-medium text-white hover:bg-[#4867cc] disabled:opacity-50";

/**
 * There is no self-service signup. This screen either bootstraps the very
 * first account (first-run setup) or signs an existing one in. Every account
 * after the first one is created by a DM, from the world's member panel — see
 * Members.tsx — never from a public form, and never with an email anywhere.
 */
export function AuthScreen({ needsSetup, onDone }: { needsSetup: boolean; onDone: () => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [worldName, setWorldName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (needsSetup) {
        await api.setup({ name, username, password, worldName });
      } else {
        await api.login({ username, password });
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        console.error(err);
        setError("Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-[#f0f1f4]">
            {needsSetup ? "Set up your world" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-[#8d9099]">
            {needsSetup
              ? "This creates the owner account and your first world."
              : "DNDWORLDAPP"}
          </p>
        </div>

        {needsSetup && (
          <input
            className={inputClass}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <input
          className={inputClass}
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          className={inputClass}
          type="password"
          placeholder={needsSetup ? "Password (10+ characters)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {needsSetup && (
          <input
            className={inputClass}
            placeholder="World name (e.g. BloodEarth)"
            value={worldName}
            onChange={(e) => setWorldName(e.target.value)}
            required
          />
        )}

        {error !== null && <p className="text-sm text-[#e0888a]">{error}</p>}

        <button className={buttonClass} disabled={busy} type="submit">
          {busy ? "Working…" : needsSetup ? "Create world" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
