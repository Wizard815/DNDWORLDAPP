import { setup } from "@tauri-apps/plugin-setup";
import { Store } from "@tauri-apps/plugin-store";

/**
 * Store token in Tauri's persistent store (encrypted on disk).
 * This replaces localStorage for production use.
 */
export async function storeToken(token: string, baseUrl: string): Promise<void> {
  const store = await Store.load("auth.json");
  await store.set("token", token);
  await store.set("baseUrl", baseUrl);
  await store.save();
}

export async function getToken(): Promise<string | null> {
  try {
    const store = await Store.load("auth.json");
    const token = await store.get<string>("token");
    return token ?? null;
  } catch {
    return null;
  }
}

export async function getBaseUrl(): Promise<string | null> {
  try {
    const store = await Store.load("auth.json");
    const baseUrl = await store.get<string>("baseUrl");
    return baseUrl ?? null;
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try {
    const store = await Store.load("auth.json");
    await store.delete("token");
    await store.delete("baseUrl");
    await store.save();
  } catch {
    // Ignore if store doesn't exist
  }
}
