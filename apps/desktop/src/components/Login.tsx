import { useState } from "react";
import { DndClient } from "@dndworldapp/dnd-client";

interface LoginProps {
  onSuccess: (client: DndClient) => void;
}

export function Login({ onSuccess }: LoginProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const client = new DndClient({ baseUrl: serverUrl, token });
      // Verify token works
      await client.whoami();
      onSuccess(client);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800 rounded-lg shadow-xl p-6">
        <h1 className="text-2xl font-bold text-white mb-2">DNDWORLDAPP</h1>
        <p className="text-gray-400 mb-6">Desktop Companion</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="serverUrl" className="block text-sm font-medium text-gray-300 mb-1">
              Server URL
            </label>
            <input
              id="serverUrl"
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://homelab.local:8080"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-300 mb-1">
              Bearer Token
            </label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="dwa_..."
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Generate from web app → Sidebar → Tokens
            </p>
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/30 p-2 rounded">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-medium rounded transition-colors"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-500 text-center">
            Linux-first • Read-only companion • No world data stored locally
          </p>
        </div>
      </div>
    </div>
  );
}
