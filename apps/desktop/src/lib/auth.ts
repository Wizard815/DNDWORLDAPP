import { DndClient, type TokenStorage } from "@dndworldapp/dnd-client";

/**
 * Extended token storage with baseUrl getter.
 * Used by both browser and Tauri implementations.
 */
export interface AuthStorage extends TokenStorage {
  /** Get stored base URL, or null if none. */
  getBaseUrl(): Promise<string | null>;
}

/**
 * Browser-based token storage (localStorage).
 * This is for development/testing. Tauri backend would use Linux keyring.
 */
export class BrowserTokenStorage implements AuthStorage {
  private readonly KEY_TOKEN = "dnd_token";
  private readonly KEY_BASE_URL = "dnd_base_url";

  async getToken(): Promise<string | null> {
    return localStorage.getItem(this.KEY_TOKEN);
  }

  async storeToken(token: string, baseUrl: string): Promise<void> {
    localStorage.setItem(this.KEY_TOKEN, token);
    localStorage.setItem(this.KEY_BASE_URL, baseUrl);
  }

  async clear(): Promise<void> {
    localStorage.removeItem(this.KEY_TOKEN);
    localStorage.removeItem(this.KEY_BASE_URL);
  }

  /** Get stored base URL, or null if none. */
  getBaseUrl(): Promise<string | null> {
    return Promise.resolve(localStorage.getItem(this.KEY_BASE_URL));
  }
}

/**
 * Tauri backend token storage (Linux keyring via secret-service).
 * Placeholder — actual implementation uses Tauri command.
 */
export class TauriTokenStorage implements AuthStorage {
  private async invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    // @ts-expect-error
    return window.__TAURI__.core.invoke(command, args);
  }

  async getToken(): Promise<string | null> {
    try {
      const token = await this.invoke<string>("get_token", {});
      return token;
    } catch {
      return null;
    }
  }

  async storeToken(token: string, baseUrl: string): Promise<void> {
    await this.invoke("store_token", { token, baseUrl });
  }

  async clear(): Promise<void> {
    await this.invoke("clear_token", {});
  }

  async getBaseUrl(): Promise<string | null> {
    try {
      const baseUrl = await this.invoke<string>("get_base_url", {});
      return baseUrl ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Create a DndClient with credentials from token storage.
 * Handles the auth flow: try stored token, fall back to login.
 */
export async function createClientWithAuth(
  tokenStorage: AuthStorage
): Promise<DndClient | null> {
  const token = await tokenStorage.getToken();
  const baseUrl = await tokenStorage.getBaseUrl();

  if (token && baseUrl) {
    return new DndClient({ baseUrl, token });
  }

  return null;
}
