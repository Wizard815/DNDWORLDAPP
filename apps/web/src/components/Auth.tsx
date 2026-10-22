import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ApiError, api } from "../api.ts";

const inputClass =
  "w-full rounded-md bg-canvas border border-line px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-faint focus:border-line-strong";
const buttonClass =
  "mt-2 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-subtle">{label}</span>
      {children}
    </label>
  );
}

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
    <div className="flex min-h-screen items-center justify-center bg-canvas-deep p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-3 rounded-xl border border-divider bg-surface p-7 shadow-pop"
      >
        <div className="mb-5 text-center">
          <div className="mb-2 text-3xl" aria-hidden="true">
            🐉
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-fg-strong">
            {needsSetup ? "Set up your world" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-fg-subtle">
            {needsSetup
              ? "This creates the owner account and your first world."
              : "Sign in to DNDWORLDAPP"}
          </p>
        </div>

        {needsSetup && (
          <Field label="Your name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
        )}
        <Field label="Username">
          <input
            className={inputClass}
            type="text"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <input
            className={inputClass}
            type="password"
            autoComplete={needsSetup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        {needsSetup && (
          <Field label="World name">
            <input
              className={inputClass}
              placeholder="e.g. BloodEarth"
              value={worldName}
              onChange={(e) => setWorldName(e.target.value)}
              required
            />
          </Field>
        )}

        {error !== null && (
          <p role="alert" className="rounded-md border border-danger-line px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button className={buttonClass} disabled={busy} type="submit">
          {busy ? "Working…" : needsSetup ? "Create world" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
