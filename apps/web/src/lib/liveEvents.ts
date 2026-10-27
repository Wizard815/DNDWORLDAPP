import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

/**
 * The world's live event stream (server: routes/events.ts). Events only say
 * *what* changed; this hook turns each one into a React Query invalidation,
 * so the data itself is always refetched through the normal API. On every
 * (re)connect everything world-related is invalidated, which covers whatever
 * happened while the socket was down.
 */

type LiveEvent =
  | { type: "hello" }
  | { type: "tree.changed" }
  | { type: "node.changed"; nodeId: string }
  | { type: "map.changed"; nodeId: string };

let connected = false;
const listeners = new Set<() => void>();
function setConnected(value: boolean): void {
  if (connected === value) return;
  connected = value;
  for (const listener of listeners) listener();
}

/** Whether the live stream is up — screens that need freshness poll as a fallback while it isn't. */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => connected,
  );
}

const MAX_BACKOFF_MS = 30_000;

export function useLiveEvents(worldId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (worldId === null) return;
    let socket: WebSocket | null = null;
    let retry: number | null = null;
    let attempts = 0;
    let stopped = false;

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/api/v1/worlds/${worldId}/events`);
      socket.onopen = () => {
        attempts = 0;
        setConnected(true);
        void queryClient.invalidateQueries();
      };
      socket.onmessage = (message) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(String(message.data)) as LiveEvent;
        } catch {
          return;
        }
        switch (event.type) {
          case "tree.changed":
            void queryClient.invalidateQueries({ queryKey: ["graph"] });
            void queryClient.invalidateQueries({ queryKey: ["tree"] });
            void queryClient.invalidateQueries({ queryKey: ["unresolved"] });
            void queryClient.invalidateQueries({ queryKey: ["tags"] });
            void queryClient.invalidateQueries({ queryKey: ["tag-pages"] });
            break;
          case "node.changed":
            void queryClient.invalidateQueries({ queryKey: ["node", event.nodeId] });
            void queryClient.invalidateQueries({ queryKey: ["posts", event.nodeId] });
            void queryClient.invalidateQueries({ queryKey: ["connections", event.nodeId] });
            void queryClient.invalidateQueries({ queryKey: ["graph"] });
            void queryClient.invalidateQueries({ queryKey: ["fields", event.nodeId] });
            break;
          case "map.changed":
            void queryClient.invalidateQueries({ queryKey: ["map", event.nodeId] });
            void queryClient.invalidateQueries({ queryKey: ["map-markers", event.nodeId] });
            void queryClient.invalidateQueries({ queryKey: ["map-groups", event.nodeId] });
            break;
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (stopped) return;
        attempts += 1;
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 5));
        retry = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry !== null) window.clearTimeout(retry);
      socket?.close();
      setConnected(false);
    };
  }, [worldId, queryClient]);
}
