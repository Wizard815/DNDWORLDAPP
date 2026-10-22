import type { Viewer } from "../auth/viewer.ts";
import { getNodeRow, isNodeVisible } from "./nodes.ts";

/**
 * Live "something changed" notifications, pushed over a WebSocket per world
 * (routes/events.ts). Deliberately content-free: an event names what changed
 * — the tree, a page, a map — and nothing else. Each client then refetches
 * through the ordinary REST API, so every byte of actual content still goes
 * through the same authorization as before and the socket can't leak any.
 * An event about a specific page is only sent to subscribers who can see it.
 */
export type WorldEvent =
  | { type: "tree.changed" }
  | { type: "node.changed"; nodeId: string }
  | { type: "map.changed"; nodeId: string };

interface Subscriber {
  worldId: string;
  viewer: Viewer;
  send: (data: string) => void;
}

const subscribers = new Set<Subscriber>();

export function subscribe(subscriber: Subscriber): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function subscriberCount(): number {
  return subscribers.size;
}

export function publish(worldId: string, event: WorldEvent): void {
  const data = JSON.stringify(event);
  for (const sub of subscribers) {
    if (sub.worldId !== worldId) continue;
    if ("nodeId" in event && !isNodeVisible(event.nodeId, sub.viewer)) continue;
    try {
      sub.send(data);
    } catch {
      // A socket that died mid-send is cleaned up by its own close handler.
    }
  }
}

/** Publish an event about one page, looking up its world. A node that no longer exists publishes nothing. */
export function publishForNode(nodeId: string, event: WorldEvent): void {
  const node = getNodeRow(nodeId);
  if (node !== null) publish(node.world_id, event);
}
