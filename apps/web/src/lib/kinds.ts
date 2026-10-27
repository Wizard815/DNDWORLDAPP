import type { NodeKind } from "@dndworldapp/schema";

/** Fallback glyph for a page with no icon of its own, by kind. */
export const KIND_GLYPH: Record<NodeKind, string> = {
  document: "📄",
  map: "🗺️",
  timeline: "🕰️",
  calendar: "📅",
  board: "🗂️",
  view: "🔎",
};

export function nodeGlyph(node: { icon: string | null; kind: NodeKind }): string {
  return node.icon ?? KIND_GLYPH[node.kind] ?? "📄";
}
