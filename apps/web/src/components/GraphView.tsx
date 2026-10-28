import { useQuery } from "@tanstack/react-query";
import cytoscape, { type Core, type ElementDefinition, type EventObject } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useEffect, useMemo, useRef, useState } from "react";
import { TAG_COLORS, type GraphDto, type GraphEdgeType, type GraphNode, type NodeKind } from "@dndworldapp/schema";
import { api } from "../api.ts";
import { KIND_GLYPH } from "../lib/kinds.ts";
import { navigate } from "../lib/nav.ts";
import { Glyph } from "./Glyph.tsx";

cytoscape.use(fcose);

/**
 * The note graph: pages as dots, wiki links as lines, and tags as dots of
 * their own that every tagged page connects to — so pages that link to each
 * other or share a tag cluster together. One component, two scopes: the whole
 * world (the Graph screen) or one page's neighborhood (the Info panel, and
 * the Graph screen when focused). The server has already removed everything
 * the viewer may not see (services/graph.ts); this only draws and filters.
 *
 * Relations, link fields, map pins and folders are extra layers, off by
 * default — family trees and org charts get their own views later.
 */

export interface GraphDisplay {
  links: boolean;
  tags: boolean;
  orphans: boolean;
  colorByTag: boolean;
  relation: boolean;
  field: boolean;
  map: boolean;
  parent: boolean;
}

const DEFAULT_DISPLAY: GraphDisplay = {
  links: true,
  tags: true,
  orphans: true,
  colorByTag: true,
  relation: false,
  field: false,
  map: false,
  parent: false,
};

const EXTRA_LAYERS: { key: Exclude<GraphEdgeType, "link">; label: string }[] = [
  { key: "relation", label: "Relations" },
  { key: "field", label: "Link fields" },
  { key: "map", label: "Pins on maps" },
  { key: "parent", label: "Folders" },
];

const DISPLAY_KEY = "dndworld.graph.display";

function loadDisplay(): GraphDisplay {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY);
    if (raw !== null) return { ...DEFAULT_DISPLAY, ...(JSON.parse(raw) as Partial<GraphDisplay>) };
  } catch {
    // Storage blocked or bad JSON: defaults.
  }
  return DEFAULT_DISPLAY;
}

function saveDisplay(display: GraphDisplay): void {
  try {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(display));
  } catch {
    // Not worth surfacing.
  }
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

/** A stable color per relation label, from the same 12-hue palette tags use. */
function labelColor(label: string): string {
  let hash = 0;
  for (const ch of label.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return cssVar(`--tag-${TAG_COLORS[hash % TAG_COLORS.length]}`);
}

const TAG_PREFIX = "tag:";
const isTagId = (id: string) => id.startsWith(TAG_PREFIX);

type Selection = { type: "page"; node: GraphNode } | { type: "tag"; id: string; name: string; color: string | null; count: number };

function buildElements(
  data: GraphDto,
  display: GraphDisplay,
  tagFilter: Set<string>,
  focusId: string | null,
  depth: number,
  compact: boolean,
): ElementDefinition[] {
  const tagById = new Map(data.tags.map((t) => [t.id, t]));
  let pages = data.nodes;
  if (tagFilter.size > 0) pages = pages.filter((n) => n.id === focusId || n.tagIds.some((t) => tagFilter.has(t)));
  const pageIds = new Set(pages.map((n) => n.id));

  const edges: ElementDefinition[] = [];
  for (const e of data.edges) {
    const on = e.type === "link" ? display.links : display[e.type];
    if (!on || !pageIds.has(e.source) || !pageIds.has(e.target)) continue;
    edges.push({
      group: "edges",
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label ?? "",
        color: e.type === "relation" || e.type === "field" ? labelColor(e.label ?? e.type) : "",
        raw: e,
      },
      classes: [e.type, e.twoWay ? "two-way" : "", e.visibility === "dm" ? "dm" : ""].join(" "),
    });
  }

  const tagCount = new Map<string, number>();
  if (display.tags) {
    for (const n of pages) {
      for (const t of n.tagIds) {
        if (!tagById.has(t)) continue;
        tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
        edges.push({
          group: "edges",
          data: { id: `tagged:${n.id}:${t}`, source: n.id, target: `${TAG_PREFIX}${t}`, label: "", color: "" },
          classes: "tagged",
        });
      }
    }
  }

  // Focused: the server walked every kind of connection; keep only what the
  // layers shown here reach within `depth` steps, so nothing floats in
  // unexplained (a relation-only neighbor while Relations is off).
  if (focusId !== null && pageIds.has(focusId)) {
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      if ((e.classes as string).startsWith("parent")) continue;
      const { source, target } = e.data as { source: string; target: string };
      adjacency.set(source, [...(adjacency.get(source) ?? []), target]);
      adjacency.set(target, [...(adjacency.get(target) ?? []), source]);
    }
    const reached = new Set([focusId]);
    let frontier = [focusId];
    for (let step = 0; step < depth; step += 1) {
      frontier = frontier.flatMap((id) => (adjacency.get(id) ?? []).filter((n) => !reached.has(n)));
      for (const id of frontier) reached.add(id);
    }
    pages = pages.filter((n) => reached.has(n.id));
    for (const id of [...tagCount.keys()]) if (!reached.has(`${TAG_PREFIX}${id}`)) tagCount.delete(id);
    const kept = edges.filter((e) => {
      const { source, target } = e.data as { source: string; target: string };
      return reached.has(source) && reached.has(target);
    });
    edges.length = 0;
    edges.push(...kept);
    for (const id of tagCount.keys()) {
      tagCount.set(id, edges.filter((e) => (e.data as { target: string }).target === `${TAG_PREFIX}${id}`).length);
    }
  }

  const degree = new Map<string, number>();
  for (const e of edges) {
    if ((e.classes as string).startsWith("parent")) continue;
    const { source, target } = e.data as { source: string; target: string };
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }
  if (!display.orphans) pages = pages.filter((n) => n.id === focusId || (degree.get(n.id) ?? 0) > 0);

  const maxDegree = Math.max(1, ...degree.values());
  const [minSize, spread] = compact ? [6, 12] : [8, 20];
  const sizeFor = (d: number) => minSize + Math.round(Math.sqrt(d / maxDegree) * spread);
  const plain = cssVar("--color-fg-muted");
  const tagFallback = cssVar("--tag-teal");

  return [
    ...pages.map((n) => {
      const firstTag = n.tagIds.map((t) => tagById.get(t)?.color).find((c) => c != null);
      return {
        group: "nodes" as const,
        data: {
          id: n.id,
          label: n.title,
          color: display.colorByTag && firstTag != null ? cssVar(`--tag-${firstTag}`) : plain,
          size: sizeFor(degree.get(n.id) ?? 0),
        },
        classes: ["page", n.effectiveVisibility === "dm" ? "dm" : "", n.id === focusId ? "focus" : ""].join(" "),
      };
    }),
    ...[...tagCount.entries()].map(([id, count]) => {
      const tag = tagById.get(id)!;
      return {
        group: "nodes" as const,
        data: {
          id: `${TAG_PREFIX}${id}`,
          label: `#${tag.name}`,
          color: tag.color !== null ? cssVar(`--tag-${tag.color}`) : tagFallback,
          size: sizeFor(count),
          count,
        },
        classes: "tag",
      };
    }),
    ...edges,
  ];
}

function stylesheet(compact: boolean): cytoscape.StylesheetJson {
  const soft = cssVar("--color-fg-soft");
  const strong = cssVar("--color-fg-strong");
  const line = cssVar("--color-line-strong");
  const secret = cssVar("--color-secret");
  const accent = cssVar("--color-accent");
  const canvas = cssVar("--color-canvas");
  return [
    {
      selector: "node",
      style: {
        width: "data(size)",
        height: "data(size)",
        "background-color": "data(color)",
        "border-width": 0,
        label: "data(label)",
        color: soft,
        "font-family": "Inter Variable, sans-serif",
        "font-size": compact ? 9 : 10,
        "text-valign": "bottom",
        "text-margin-y": 3,
        "text-max-width": "140px",
        "text-wrap": "ellipsis",
        // Labels fade out when zoomed far out, as in a note app's graph.
        "min-zoomed-font-size": 8,
      },
    },
    { selector: "node.tag", style: { shape: "ellipse", "font-style": "italic" } },
    { selector: "node.dm", style: { "border-width": 1.5, "border-color": secret, "border-style": "dashed" } },
    { selector: "node.focus", style: { "border-width": 2, "border-color": accent, label: "data(label)" } },
    { selector: "node.hl", style: { label: "data(label)", color: strong, "z-index": 10 } },
    { selector: "node:selected", style: { "border-width": 2, "border-color": accent, label: "data(label)" } },
    {
      selector: "edge",
      style: { width: 1, "line-color": line, "curve-style": "straight", opacity: 0.5, "target-arrow-shape": "none" },
    },
    { selector: "edge.tagged", style: { opacity: 0.3 } },
    {
      selector: "edge.relation, edge.field",
      style: {
        width: 1.5,
        "line-color": "data(color)",
        "target-arrow-color": "data(color)",
        "source-arrow-color": "data(color)",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.7,
        opacity: 0.8,
        "font-size": 9,
        color: soft,
        "text-rotation": "autorotate",
        "text-background-color": canvas,
        "text-background-opacity": 0.85,
        "text-background-padding": "2px",
      },
    },
    { selector: "edge.field", style: { "line-style": "dashed" } },
    { selector: "edge.two-way", style: { "source-arrow-shape": "triangle" } },
    { selector: "edge.dm", style: { "line-color": secret, "target-arrow-color": secret, "source-arrow-color": secret } },
    { selector: "edge.map", style: { "line-style": "dotted" } },
    { selector: "edge.parent", style: { opacity: 0.25 } },
    { selector: "edge.hl", style: { opacity: 0.9, "line-color": accent, "z-index": 5 } },
    { selector: "edge.hl.relation, edge.hl.field", style: { "line-color": "data(color)", label: "data(label)" } },
    { selector: ".faded", style: { opacity: 0.1 } },
  ];
}

function runLayout(cy: Core, animate: boolean): void {
  if (cy.nodes().length === 0) return;
  // Fitting a handful of nodes zooms far in; cap it so a small world reads at normal size.
  cy.one("layoutstop", () => {
    if (cy.zoom() > 1.4) {
      cy.zoom(1.4);
      cy.center();
    }
  });
  cy.layout({
    name: "fcose",
    quality: "default",
    animate,
    animationDuration: 500,
    fit: true,
    padding: 30,
    randomize: true,
    nodeRepulsion: 9000,
    idealEdgeLength: 80,
    gravity: 0.3,
    // Unconnected pages are tiled beside the graph; leave room for their labels.
    tilingPaddingVertical: 30,
    tilingPaddingHorizontal: 60,
  } as cytoscape.LayoutOptions).run();
}

export function GraphView({
  worldId,
  focusId = null,
  compact = false,
  initialDepth = 1,
}: {
  worldId: string;
  focusId?: string | null;
  /** The Info panel's small local graph: smaller dots, minimal controls. */
  compact?: boolean;
  initialDepth?: number;
}) {
  const [depth, setDepth] = useState(initialDepth);
  const [display, setDisplayState] = useState<GraphDisplay>(loadDisplay);
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selection | null>(null);
  const [hoverEdge, setHoverEdge] = useState<{ x: number; y: number; text: string; note: string | null } | null>(null);
  const [search, setSearch] = useState("");
  const [layoutRun, setLayoutRun] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const setDisplay = (patch: Partial<GraphDisplay>) =>
    setDisplayState((prev) => {
      const next = { ...prev, ...patch };
      saveDisplay(next);
      return next;
    });

  const graph = useQuery({
    queryKey: ["graph", worldId, focusId, focusId !== null ? depth : 0, focusId !== null && display.tags],
    queryFn: () => api.graph(worldId, focusId ?? undefined, depth, display.tags),
    placeholderData: (previous) => previous,
  });
  const data = graph.data?.graph;
  const nodesById = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const tagsById = useMemo(() => new Map((data?.tags ?? []).map((t) => [t.id, t])), [data]);
  // Cytoscape's handlers are bound once; they read the current data through these.
  const lookup = useRef({ nodesById, tagsById, selectedId: null as string | null });
  lookup.current.nodesById = nodesById;
  lookup.current.tagsById = tagsById;

  // Create cytoscape once.
  useEffect(() => {
    if (containerRef.current === null) return;
    const cy = cytoscape({
      container: containerRef.current,
      style: stylesheet(compact),
      minZoom: 0.1,
      maxZoom: 4,
      boxSelectionEnabled: false,
    });
    cyRef.current = cy;

    /** Light up a node and its neighbors, fade the rest; null clears. */
    const highlight = (id: string | null) => {
      cy.batch(() => {
        cy.elements().removeClass("faded hl");
        if (id === null) return;
        const node = cy.getElementById(id);
        if (node.empty()) return;
        const near = node.closedNeighborhood();
        near.addClass("hl");
        cy.elements().not(near).addClass("faded");
      });
    };
    cy.on("mouseover", "node", (e: EventObject) => highlight(e.target.id() as string));
    cy.on("mouseout", "node", () => highlight(lookup.current.selectedId));
    cy.on("tap", "node", (e: EventObject) => {
      const id = e.target.id() as string;
      lookup.current.selectedId = id;
      if (isTagId(id)) {
        const tag = lookup.current.tagsById.get(id.slice(TAG_PREFIX.length));
        setSelected(
          tag === undefined ? null : { type: "tag", id: tag.id, name: tag.name, color: tag.color, count: e.target.data("count") as number },
        );
      } else {
        const node = lookup.current.nodesById.get(id);
        setSelected(node === undefined ? null : { type: "page", node });
      }
      highlight(id);
    });
    cy.on("tap", (e: EventObject) => {
      if (e.target === cy) {
        lookup.current.selectedId = null;
        setSelected(null);
        highlight(null);
      }
    });
    cy.on("dbltap", "node", (e: EventObject) => {
      const id = e.target.id() as string;
      navigate(isTagId(id) ? `/tags/${id.slice(TAG_PREFIX.length)}` : `/n/${id}`);
    });
    cy.on("mouseover", "edge", (e: EventObject) => {
      const pos = e.renderedPosition ?? { x: 0, y: 0 };
      const { nodesById: pages, tagsById: tags } = lookup.current;
      if (e.target.hasClass("tagged")) {
        const page = pages.get(e.target.data("source") as string)?.title ?? "";
        const tag = tags.get((e.target.data("target") as string).slice(TAG_PREFIX.length))?.name ?? "";
        setHoverEdge({ x: pos.x, y: pos.y, text: `${page} is tagged #${tag}`, note: null });
        return;
      }
      const raw = e.target.data("raw") as GraphDto["edges"][number];
      const source = pages.get(raw.source)?.title ?? "";
      const target = pages.get(raw.target)?.title ?? "";
      const text =
        raw.type === "relation" || raw.type === "field"
          ? `${source} ${raw.twoWay ? "↔" : "→"} ${raw.label ?? ""} ${target}${raw.inverseLabel !== null ? ` (${target} ${raw.inverseLabel} ${source})` : ""}`
          : raw.type === "link"
            ? `${source} links to ${target}`
            : raw.type === "map"
              ? `${target} is on ${source}${raw.label !== null ? ` (${raw.label})` : ""}`
              : `${target} is inside ${source}`;
      setHoverEdge({ x: pos.x, y: pos.y, text, note: raw.note });
    });
    cy.on("mouseout", "edge", () => setHoverEdge(null));
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [compact]);

  // (Re)build elements whenever the data or a filter changes, then lay out.
  useEffect(() => {
    const cy = cyRef.current;
    if (cy === null || data === undefined) return;
    cy.elements().remove();
    cy.add(buildElements(data, display, tagFilter, focusId, depth, compact));
    cy.style(stylesheet(compact));
    runLayout(cy, !compact);
    lookup.current.selectedId = null;
    setSelected(null);
  }, [data, display, tagFilter, focusId, depth, compact, layoutRun]);

  const jumpTo = (query: string) => {
    const cy = cyRef.current;
    if (cy === null) return;
    const needle = query.trim().toLowerCase().replace(/^#/, "");
    if (needle.length === 0) return;
    const node = cy
      .nodes()
      .filter((n) => (n.data("label") as string).toLowerCase().replace(/^#/, "").includes(needle))
      .first();
    if (node.empty()) return;
    cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 300 });
    node.emit("tap");
  };

  const toggleTag = (id: string) =>
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const empty = data !== undefined && data.nodes.length <= (focusId !== null ? 1 : 0) && (data.tags.length === 0 || !display.tags);
  const button = "rounded px-2 py-1 text-xs text-fg-soft hover:bg-press";
  const heading = "mb-1 block text-[10px] uppercase tracking-wide text-fg-faint";
  const check = (key: keyof GraphDisplay, label: string, hint?: string) => (
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-fg-soft" title={hint}>
      <input type="checkbox" checked={display[key]} onChange={() => setDisplay({ [key]: !display[key] })} className="accent-accent" />
      {label}
    </label>
  );

  return (
    <div className={`relative overflow-hidden bg-canvas ${compact ? "h-56 rounded-md border border-line" : "h-full w-full"}`}>
      {/* Inline, not Tailwind: cytoscape injects an unlayered `position: relative` that beats utility classes. */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} aria-label="Graph of linked pages and tags" role="img" />

      {graph.isLoading && <p className="absolute inset-0 flex items-center justify-center text-xs text-fg-muted">Loading graph…</p>}
      {empty && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-fg-muted">
          {focusId !== null ? "Nothing connected yet — link a page with [[ ]] or add a #tag." : "Nothing to draw yet."}
        </p>
      )}

      {compact ? (
        <div className="absolute right-1 top-1 z-10 flex gap-0.5 rounded-md border border-line bg-surface/95 p-0.5 text-[10px]">
          {[1, 2, 3].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDepth(d)}
              aria-pressed={depth === d}
              title={`${d} step${d > 1 ? "s" : ""} out`}
              className={`rounded px-1.5 py-0.5 ${depth === d ? "bg-accent text-on-accent" : "text-fg-muted hover:text-fg"}`}
            >
              {d}
            </button>
          ))}
          {focusId !== null && (
            <button
              type="button"
              onClick={() => navigate(`/graph/${focusId}`)}
              title="Open the full graph here"
              className="rounded px-1.5 py-0.5 text-fg-muted hover:text-fg"
            >
              ⤢
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="absolute right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-1 rounded-md border border-line bg-surface/95 p-1 shadow-lg">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpTo(search);
              }}
              placeholder="Find a page or #tag…"
              aria-label="Find a page or tag in the graph"
              className="w-40 rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
            />
            <button type="button" onClick={() => cyRef.current?.fit(undefined, 30)} className={button} title="Fit everything in view">
              ⤢ Fit
            </button>
            <button type="button" onClick={() => setLayoutRun((n) => n + 1)} className={button} title="Lay the graph out again">
              ⟳ Rearrange
            </button>
          </div>

          <div className="absolute bottom-3 left-3 z-10 max-h-[70%] w-56 overflow-y-auto rounded-md border border-line bg-surface/95 p-3 text-xs shadow-lg">
            {focusId !== null && (
              <div className="mb-3">
                <span className={heading}>Steps out</span>
                <div className="flex gap-1">
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDepth(d)}
                      aria-pressed={depth === d}
                      className={`flex-1 rounded px-2 py-0.5 ${depth === d ? "bg-accent text-on-accent" : "border border-line text-fg-muted hover:text-fg"}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <span className={heading}>Show</span>
            {check("links", "Links", "A line for each [[link]] between two pages")}
            {check("tags", "Tags", "Each #tag as its own dot, joined to every page that has it")}
            {check("orphans", "Unconnected pages", "Pages with no links or tags")}
            {check("colorByTag", "Color pages by tag", "A page takes its first tag's color; untagged pages stay grey")}
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-[10px] uppercase tracking-wide text-fg-faint hover:text-fg-muted">
                More connections
              </summary>
              <div className="mt-1">
                {EXTRA_LAYERS.map(({ key, label }) => (
                  <span key={key}>{check(key, label)}</span>
                ))}
              </div>
            </details>
            {(data?.tags.length ?? 0) > 0 && (
              <>
                <span className={`${heading} mt-3`}>Only pages tagged</span>
                <div className="flex flex-wrap gap-1">
                  {data!.tags.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTag(t.id)}
                      aria-pressed={tagFilter.has(t.id)}
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        tagFilter.has(t.id) ? "border-accent text-fg-strong" : "border-line text-fg-muted hover:text-fg"
                      }`}
                      style={t.color !== null ? { color: `var(--tag-${t.color})` } : undefined}
                    >
                      #{t.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            {data?.truncated === true && (
              <p className="mt-3 text-[10px] text-danger">Too many pages to draw at once — showing the best-connected. Filter by tag.</p>
            )}
          </div>

          {selected !== null && (
            <div className="absolute bottom-3 right-3 z-10 w-64 rounded-md border border-line bg-surface p-3 text-sm shadow-pop">
              {selected.type === "page" ? (
                <PageCard node={selected.node} tagsById={tagsById} />
              ) : (
                <>
                  <p className="mb-1 truncate font-medium" style={selected.color !== null ? { color: `var(--tag-${selected.color})` } : undefined}>
                    #{selected.name}
                  </p>
                  <p className="mb-2 text-[11px] text-fg-muted">
                    Tag · {selected.count} page{selected.count === 1 ? "" : "s"} here
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate(`/tags/${selected.id}`)}
                    className="rounded bg-accent px-2 py-1 text-xs text-on-accent hover:bg-accent-hover"
                  >
                    Open tag
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {hoverEdge !== null && (
        <div
          className="pointer-events-none absolute z-20 max-w-xs rounded border border-line bg-raised px-2 py-1 text-[11px] text-fg shadow-pop"
          style={{ left: hoverEdge.x + 12, top: hoverEdge.y + 12 }}
        >
          {hoverEdge.text}
          {hoverEdge.note !== null && <span className="block text-fg-muted">{hoverEdge.note}</span>}
        </div>
      )}
    </div>
  );
}

function PageCard({ node, tagsById }: { node: GraphNode; tagsById: Map<string, GraphDto["tags"][number]> }) {
  const kind: NodeKind = node.kind;
  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <Glyph icon={node.icon ?? KIND_GLYPH[kind] ?? "📄"} />
        <span className="truncate font-medium text-fg-strong">{node.title}</span>
      </div>
      <p className="mb-2 text-[11px] text-fg-muted">
        {kind} · {node.degree} connection{node.degree === 1 ? "" : "s"}
        {node.effectiveVisibility === "dm" && <span className="text-secret"> · DM only</span>}
      </p>
      {node.tagIds.length > 0 && (
        <p className="mb-2 flex flex-wrap gap-1 text-[10px]">
          {node.tagIds.map((id) => {
            const tag = tagsById.get(id);
            return tag === undefined ? null : (
              <span key={id} style={tag.color !== null ? { color: `var(--tag-${tag.color})` } : undefined}>
                #{tag.name}
              </span>
            );
          })}
        </p>
      )}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => navigate(`/n/${node.id}`)}
          className="rounded bg-accent px-2 py-1 text-xs text-on-accent hover:bg-accent-hover"
        >
          Open page
        </button>
        <button
          type="button"
          onClick={() => navigate(`/graph/${node.id}`)}
          className="rounded border border-line px-2 py-1 text-xs text-fg-soft hover:bg-press"
        >
          Focus here
        </button>
      </div>
    </>
  );
}

export default GraphView;
