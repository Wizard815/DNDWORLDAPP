import { useEffect, useState } from "react";

/**
 * Node URLs are flat (`/n/<id>`), the way LegendKeeper does it: a page keeps its
 * address no matter where it is dragged in the tree. That makes a hand-rolled
 * router enough for now — a real router arrives when there are real routes.
 */

const listeners = new Set<(path: string) => void>();

export function navigate(to: string): void {
  if (to === window.location.pathname) return;
  window.history.pushState({}, "", to);
  for (const listener of listeners) listener(to);
}

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    listeners.add(setPath);
    window.addEventListener("popstate", onPop);
    return () => {
      listeners.delete(setPath);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  return path;
}

export function nodeIdFromPath(path: string): string | null {
  const match = /^\/n\/([a-z0-9]+)/.exec(path);
  return match?.[1] ?? null;
}
