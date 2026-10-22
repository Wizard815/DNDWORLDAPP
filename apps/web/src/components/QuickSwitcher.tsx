import { useEffect, useMemo, useState } from "react";
import type { NodeSummary, SearchHit } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { sanitizeSnippet } from "../lib/markdown.ts";
import { navigate } from "../lib/nav.ts";

/**
 * Ctrl+K. Titles match instantly from the tree already in memory; full-text hits
 * arrive from the server a moment later and fill in below.
 */
export function QuickSwitcher({
  worldId,
  nodes,
  onClose,
}: {
  worldId: string;
  nodes: NodeSummary[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState(0);

  const titleMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return nodes.slice(0, 10);
    if (needle.startsWith("#")) {
      const tag = needle.slice(1);
      return nodes.filter((n) => n.tagNames.some((t) => t.toLowerCase().startsWith(tag))).slice(0, 10);
    }
    return nodes.filter((n) => n.title.toLowerCase().includes(needle)).slice(0, 10);
  }, [query, nodes]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void api
        .search(worldId, needle)
        .then((result) => setHits(result.hits))
        .catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, worldId]);

  const bodyOnly = hits.filter((hit) => !titleMatches.some((n) => n.id === hit.nodeId));
  const total = titleMatches.length + bodyOnly.length;

  function open(nodeId: string): void {
    navigate(`/n/${nodeId}`);
    onClose();
  }

  return (
    <div
      // z-[2050], not z-50: must clear MapView's in-map overlays (z-[1000]) when the current page is a map.
      className="modal-backdrop pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, Math.max(total - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              const chosen =
                index < titleMatches.length
                  ? titleMatches[index]?.id
                  : bodyOnly[index - titleMatches.length]?.nodeId;
              if (chosen !== undefined) open(chosen);
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder="Jump to a page, #tag, or search everything…"
          className="w-full border-b border-selected bg-transparent px-4 py-3 text-sm outline-none"
        />

        <ul className="max-h-80 overflow-y-auto py-1">
          {titleMatches.map((node, i) => (
            <li key={node.id}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => open(node.id)}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                  i === index ? "bg-hover-strong text-fg-strong" : "text-fg-soft"
                }`}
              >
                <span>{node.icon ?? "📄"}</span>
                <span className="truncate">{node.title}</span>
                {node.effectiveVisibility === "dm" && (
                  <span className="ml-auto text-[10px] text-secret">DM</span>
                )}
              </button>
            </li>
          ))}

          {bodyOnly.length > 0 && (
            <li className="px-4 pb-1 pt-3 text-[10px] uppercase tracking-wide text-fg-faint">
              In page text
            </li>
          )}
          {bodyOnly.map((hit, i) => {
            const position = titleMatches.length + i;
            return (
              <li key={hit.nodeId}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => open(hit.nodeId)}
                  className={`block w-full px-4 py-2 text-left ${
                    position === index ? "bg-hover-strong" : ""
                  }`}
                >
                  <span className="block truncate text-sm text-fg-soft">
                    {hit.icon ?? "📄"} {hit.title}
                  </span>
                  <span
                    className="block truncate text-xs text-fg-muted [&_mark]:bg-mark [&_mark]:text-mark-fg"
                    dangerouslySetInnerHTML={{ __html: sanitizeSnippet(hit.snippet) }}
                  />
                </button>
              </li>
            );
          })}

          {total === 0 && (
            <li className="px-4 py-6 text-center text-xs text-fg-faint">No pages found.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
