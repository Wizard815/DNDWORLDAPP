import { useQuery } from "@tanstack/react-query";
import cytoscape, { type Core, type ElementDefinition, type EventObject } from "cytoscape";
import dagre from "cytoscape-dagre";
import fcose from "cytoscape-fcose";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TAG_COLORS,
  iconSvgUrl,
  imageIconUrl,
  parseIconRef,
  type GraphDto,
  type GraphEdgeType,
  type GraphNode,
  type NodeKind,
} from "@dndworldapp/schema";
import { api } from "../api.ts";
import { KIND_GLYPH } from "../lib/kinds.ts";
import { navigate } from "../lib/nav.ts";
import { Glyph } from "./Glyph.tsx";

cytoscape.use(fcose);
cytoscape.use(dagre);

/**
 * The graph (design doc §5): one component, two scopes — the whole world
 * (the Graph screen) or one page's neighborhood (the Info panel, and the
 * Graph screen when focused). The server has already removed everything the
 * viewer may not see (services/graph.ts); this only draws and filters.
 *
 * One visual language everywhere: relations bold and colored by label with
 * arrowheads, link fields the same but dashed, wiki links thin and grey,
 * map pins dotted, folder structure faint. Node color is the page's first
 * tag (or its kind), node size its number of connections. DM-only things are
 * outlined in the secret color — only a DM's graph ever has any.
 */

export type GraphLayers = Record<GraphEdgeType, boolean>;
export const DEFAULT_LAYERS: GraphLayers = { relation: true, field: true, link: true, map: false, parent: false };

const LAYER_LABEL: Record<GraphEdgeType, string> = {
  relation: "Relations",
  field: "Link fields",
  link: "Links",
  map: "On maps",
  parent: "Folders",
};

const KIND_COLOR: Record<NodeKind, (typeof TAG_COLORS)[number]> = {
  document: "slate",
  map: "green",
  timeline: "amber",
  calendar: "teal",
  board: "indigo",
  view: "violet",
};

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

/** A stable color per relation label, from the same 12-hue palette tags use. */
function labelColor(label: string): string {
  let hash = 0;
  for (const ch of label.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return cssVar(`--tag-${TAG_COLORS[hash % TAG_COLORS.length]}`);
}

/** A page icon as something cytoscape can paint inside a node: an image URL, the library SVG, or an emoji drawn into an SVG. */
function iconImage(node: GraphNode): string {
  const icon = node.icon ?? KIND_GLYPH[node.kind] ?? "📄";
  const image = imageIconUrl(icon);
  if (image !== null) return image;
  const ref = parseIconRef(icon);
  if (ref !== null) return iconSvgUrl(ref);
  const safe = icon.replace(/[<>&"']/g, "");
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><text x="32" y="46" font-size="40" text-anchor="middle">${safe}</text></svg>`,
  )}`;
}

function buildElements(
  data: GraphDto,
  layers: GraphLayers,
  tagFilter: Set<string>,
  colorBy: "tag" | "kind",
  focusId: string | null,
): ElementDefinition[] {
  const tagColor = new Map(data.tags.map((t) => [t.id, t.color]));
  let nodes = data.nodes;
  if (tagFilter.size > 0) nodes = nodes.filter((n) => n.id === focusId || n.tagIds.some((t) => tagFilter.has(t)));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => layers[e.type] && ids.has(e.source) && ids.has(e.target));
  const maxDegree = Math.max(1, ...nodes.map((n) => n.degree));

  return [
    ...nodes.map((n) => {
      const firstTagColor = n.tagIds.map((t) => tagColor.get(t)).find((c) => c != null);
      const color =
        colorBy === "tag" && firstTagColor != null ? cssVar(`--tag-${firstTagColor}`) : cssVar(`--tag-${KIND_COLOR[n.kind] ?? "slate"}`);
      return {
        group: "nodes" as const,
        data: {
          id: n.id,
          label: n.title,
          color,
          image: iconImage(n),
          size: 26 + Math.round((Math.sqrt(n.degree) / Math.sqrt(maxDegree)) * 30),
        },
        classes: [n.effectiveVisibility === "dm" ? "dm" : "", n.id === focusId ? "focus" : ""].join(" "),
      };
    }),
    ...edges.map((e) => ({
      group: "edges" as const,
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label ?? "",
        color: e.type === "relation" || e.type === "field" ? labelColor(e.label ?? e.type) : "",
        raw: e,
      },
      classes: [e.type, e.twoWay ? "two-way" : "", e.visibility === "dm" ? "dm" : ""].join(" "),
    })),
  ];
}

function stylesheet(compact: boolean): cytoscape.StylesheetJson {
  const fg = cssVar("--color-fg-soft");
  const faint = cssVar("--color-fg-faint");
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
        "background-image": "data(image)",
        "background-fit": "contain",
        "background-clip": "node",
        "background-width": "62%",
        "background-height": "62%",
        "border-width": 2,
        "border-color": canvas,
        label: compact ? "" : "data(label)",
        color: fg,
        "font-family": "Inter Variable, sans-serif",
        "font-size": 11,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-max-width": "120px",
        "text-wrap": "ellipsis",
        "min-zoomed-font-size": 7,
      },
    },
    { selector: "node.dm", style: { "border-color": secret, "border-style": "dashed" } },
    { selector: "node.focus", style: { "border-color": accent, "border-width": 3, label: "data(label)" } },
    { selector: "node:selected", style: { "border-color": accent, "border-width": 3, label: "data(label)" } },
    {
      selector: "edge",
      style: { width: 1, "line-color": line, "curve-style": "bezier", opacity: 0.7, "target-arrow-shape": "none" },
    },
    {
      selector: "edge.relation, edge.field",
      style: {
        width: 3,
        "line-color": "data(color)",
        "target-arrow-color": "data(color)",
        "source-arrow-color": "data(color)",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        opacity: 0.95,
        label: "data(label)",
        "font-size": 9,
        color: faint,
        "text-rotation": "autorotate",
        "text-background-color": canvas,
        "text-background-opacity": 0.85,
        "text-background-padding": "2px",
        "min-zoomed-font-size": 10,
      },
    },
    { selector: "edge.field", style: { "line-style": "dashed" } },
    { selector: "edge.two-way", style: { "source-arrow-shape": "triangle" } },
    { selector: "edge.dm", style: { "line-color": secret, "target-arrow-color": secret, "source-arrow-color": secret } },
    { selector: "edge.map", style: { "line-style": "dotted", width: 1.5 } },
    { selector: "edge.parent", style: { opacity: 0.35, "curve-style": "straight", width: 1 } },
    { selector: ".faded", style: { opacity: 0.18 } },
    { selector: "edge.faded", style: { label: "" } },
  ];
}

function runLayout(cy: Core, layout: "force" | "tree", animate: boolean): void {
  if (cy.nodes().length === 0) return;
  const options =
    layout === "tree"
      ? ({ name: "dagre", rankDir: "TB", nodeSep: 30, rankSep: 60, animate, fit: true, padding: 30 } as cytoscape.LayoutOptions)
      : ({
          name: "fcose",
          quality: "default",
          animate,
          animationDuration: 400,
          fit: true,
          padding: 30,
          nodeRepulsion: 9000,
          idealEdgeLength: 90,
          randomize: true,
          // Unconnected pages are tiled beside the graph; leave room for their labels.
          tilingPaddingVertical: 40,
          tilingPaddingHorizontal: 70,
        } as cytoscape.LayoutOptions);
  // Fitting a handful of nodes zooms far in; cap it so a small world reads at normal size.
  cy.one("layoutstop", () => {
    if (cy.zoom() > 1.2) {
      cy.zoom(1.2);
      cy.center();
    }
  });
  cy.layout(options).run();
}

export function GraphView({
  worldId,
  focusId = null,
  compact = false,
  initialDepth = 1,
}: {
  worldId: string;
  focusId?: string | null;
  /** The Info panel's small local graph: no labels until hover, minimal controls. */
  compact?: boolean;
  initialDepth?: number;
}) {
  const [depth, setDepth] = useState(initialDepth);
  const [layers, setLayers] = useState<GraphLayers>(DEFAULT_LAYERS);
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [colorBy, setColorBy] = useState<"tag" | "kind">("tag");
  const [layout, setLayout] = useState<"force" | "tree">("force");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hoverEdge, setHoverEdge] = useState<{ x: number; y: number; text: string; note: string | null } | null>(null);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const graph = useQuery({
    queryKey: ["graph", worldId, focusId, focusId !== null ? depth : 0],
    queryFn: () => api.graph(worldId, focusId ?? undefined, depth),
    placeholderData: (previous) => previous,
  });
  const data = graph.data?.graph;
  const nodesById = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  // Cytoscape's handlers are bound once; they read the current data through this.
  const nodesByIdRef = useRef(nodesById);
  nodesByIdRef.current = nodesById;

  // Create cytoscape once.
  useEffect(() => {
    if (containerRef.current === null) return;
    const cy = cytoscape({
      container: containerRef.current,
      style: stylesheet(compact),
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 4,
      boxSelectionEnabled: false,
    });
    cyRef.current = cy;

    const focusOn = (id: string | null) => {
      cy.elements().removeClass("faded");
      if (id === null) return;
      const node = cy.getElementById(id);
      if (node.empty()) return;
      cy.elements().not(node.closedNeighborhood()).addClass("faded");
    };
    cy.on("tap", "node", (e: EventObject) => {
      const id = e.target.id() as string;
      setSelected(nodesByIdRef.current.get(id) ?? null);
      focusOn(id);
    });
    cy.on("tap", (e: EventObject) => {
      if (e.target === cy) {
        setSelected(null);
        focusOn(null);
      }
    });
    cy.on("dbltap", "node", (e: EventObject) => navigate(`/n/${e.target.id() as string}`));
    cy.on("mouseover", "edge", (e: EventObject) => {
      const raw = e.target.data("raw") as GraphDto["edges"][number];
      const pos = e.renderedPosition ?? { x: 0, y: 0 };
      const source = nodesByIdRef.current.get(raw.source)?.title ?? "";
      const target = nodesByIdRef.current.get(raw.target)?.title ?? "";
      const verb =
        raw.type === "relation" || raw.type === "field"
          ? `${source} ${raw.twoWay ? "↔" : "→"} ${raw.label ?? ""} ${target}${raw.inverseLabel !== null ? ` (${target} ${raw.inverseLabel} ${source})` : ""}`
          : raw.type === "link"
            ? `${source} links to ${target}`
            : raw.type === "map"
              ? `${target} is on ${source}${raw.label !== null ? ` (${raw.label})` : ""}`
              : `${target} is inside ${source}`;
      setHoverEdge({ x: pos.x, y: pos.y, text: verb, note: raw.note });
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
    cy.add(buildElements(data, layers, tagFilter, colorBy, focusId));
    cy.style(stylesheet(compact));
    runLayout(cy, layout, !compact);
    setSelected(null);
  }, [data, layers, tagFilter, colorBy, layout, focusId, compact]);

  const jumpTo = (query: string) => {
    const cy = cyRef.current;
    if (cy === null) return;
    const needle = query.trim().toLowerCase();
    const match = (data?.nodes ?? []).find((n) => n.title.toLowerCase().includes(needle));
    if (match === undefined) return;
    const node = cy.getElementById(match.id);
    if (node.empty()) return;
    cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 300 });
    node.emit("tap");
  };

  const toggleLayer = (type: GraphEdgeType) => setLayers((prev) => ({ ...prev, [type]: !prev[type] }));
  const toggleTag = (id: string) =>
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const empty = data !== undefined && data.nodes.length <= (focusId !== null ? 1 : 0);
  const button = "rounded px-2 py-1 text-xs text-fg-soft hover:bg-press";

  return (
    <div className={`relative overflow-hidden bg-canvas ${compact ? "h-56 rounded-md border border-line" : "h-full w-full"}`}>
      {/* Inline, not Tailwind: cytoscape injects an unlayered `position: relative` that beats utility classes. */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} aria-label="Graph of connected pages" role="img" />

      {graph.isLoading && <p className="absolute inset-0 flex items-center justify-center text-xs text-fg-muted">Loading graph…</p>}
      {empty && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-fg-muted">
          {focusId !== null ? "No connections yet — add a relation or link a page." : "Nothing to draw yet."}
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
              placeholder="Find a page…"
              aria-label="Find a page in the graph"
              className="w-36 rounded border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-faint focus:border-line-strong"
            />
            <button type="button" onClick={() => setLayout(layout === "force" ? "tree" : "force")} className={button} title="Switch layout">
              {layout === "force" ? "⟡ Force" : "⊤ Tree"}
            </button>
            <button type="button" onClick={() => cyRef.current?.fit(undefined, 30)} className={button} title="Fit everything in view">
              ⤢ Fit
            </button>
            <button type="button" onClick={() => setColorBy(colorBy === "tag" ? "kind" : "tag")} className={button} title="What node color means">
              ● By {colorBy}
            </button>
          </div>

          <div className="absolute bottom-3 left-3 z-10 max-h-[60%] w-56 overflow-y-auto rounded-md border border-line bg-surface/95 p-3 text-xs shadow-lg">
            {focusId !== null && (
              <div className="mb-3">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-fg-faint">Depth</span>
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
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-fg-faint">Layers</span>
            {(Object.keys(LAYER_LABEL) as GraphEdgeType[]).map((type) => (
              <label key={type} className="flex cursor-pointer items-center gap-2 py-0.5 text-fg-soft">
                <input type="checkbox" checked={layers[type]} onChange={() => toggleLayer(type)} className="accent-accent" />
                <LayerSwatch type={type} />
                {LAYER_LABEL[type]}
              </label>
            ))}
            {(data?.tags.length ?? 0) > 0 && (
              <>
                <span className="mb-1 mt-3 block text-[10px] uppercase tracking-wide text-fg-faint">Only pages tagged</span>
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
              <div className="mb-1 flex items-center gap-2">
                <Glyph icon={selected.icon ?? KIND_GLYPH[selected.kind] ?? "📄"} />
                <span className="truncate font-medium text-fg-strong">{selected.title}</span>
              </div>
              <p className="mb-2 text-[11px] text-fg-muted">
                {selected.kind} · {selected.degree} connection{selected.degree === 1 ? "" : "s"}
                {selected.effectiveVisibility === "dm" && <span className="text-secret"> · DM only</span>}
              </p>
              {selected.tagIds.length > 0 && (
                <p className="mb-2 flex flex-wrap gap-1 text-[10px]">
                  {selected.tagIds.map((id) => {
                    const tag = data?.tags.find((t) => t.id === id);
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
                  onClick={() => navigate(`/n/${selected.id}`)}
                  className="rounded bg-accent px-2 py-1 text-xs text-on-accent hover:bg-accent-hover"
                >
                  Open page
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/graph/${selected.id}`)}
                  className="rounded border border-line px-2 py-1 text-xs text-fg-soft hover:bg-press"
                >
                  Focus here
                </button>
              </div>
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

/** The legend: each layer's line as the graph draws it. */
function LayerSwatch({ type }: { type: GraphEdgeType }) {
  const style =
    type === "relation"
      ? "border-t-[3px] border-solid"
      : type === "field"
        ? "border-t-[3px] border-dashed"
        : type === "map"
          ? "border-t-2 border-dotted"
          : type === "parent"
            ? "border-t border-solid opacity-40"
            : "border-t border-solid";
  const color = type === "relation" || type === "field" ? "var(--tag-indigo)" : "var(--color-line-strong)";
  return <span aria-hidden="true" className={`inline-block w-5 ${style}`} style={{ borderColor: color }} />;
}

export default GraphView;
