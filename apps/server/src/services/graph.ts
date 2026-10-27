import { GRAPH_MAX_NODES, type GraphDto, type GraphEdge, type GraphNode } from "@dndworldapp/schema";
import { readableLevels } from "../auth/policy.ts";
import type { Viewer } from "../auth/viewer.ts";
import { db } from "../db/index.ts";
import type { NodeKind, Visibility } from "@dndworldapp/schema";
import { defsByKey } from "./fields.ts";
import { listMarkers } from "./maps.ts";
import { readableNodeSql } from "./nodes.ts";
import { visibleRelationsSql } from "./relations.ts";

/**
 * The graph (design doc §4): every page the viewer can see, and every edge
 * between two of them — relations, link-type fields, wiki links, map pins
 * ("placed on", from the map to the page) and parent/child structure.
 *
 * Filtering reuses each feature's own rules rather than restating them:
 * readableNodeSql for pages, visibleRelationsSql for relations, field
 * visibility for link fields, the already secret-stripped `links` index for
 * wiki links, and listMarkers() — marker visibility and fog — for map edges.
 * A page the viewer can't see is absent along with everything touching it.
 *
 * With `focus`, only pages within `depth` steps of that page are returned,
 * walking every edge kind except parent/child (folder siblings aren't
 * "connected" in the sense the local graph means); parent edges between the
 * pages that made it in are still included, for the structure layer.
 */

interface NodeRowLite {
  id: string;
  title: string;
  icon: string | null;
  kind: NodeKind;
  effective_visibility: Visibility;
  parent_id: string | null;
}

export function worldGraph(worldId: string, viewer: Viewer, focus?: string, depth = 1): GraphDto {
  const vis = readableNodeSql("n", viewer);
  const rows = db
    .prepare(
      `SELECT n.id, n.title, n.icon, n.kind, n.effective_visibility, n.parent_id FROM nodes n
       WHERE n.world_id = ? AND n.is_archived = 0 AND ${vis.sql} ORDER BY n.sort_key`,
    )
    .all(worldId, ...vis.params) as unknown as NodeRowLite[];
  const visible = new Set(rows.map((r) => r.id));
  const both = (a: string, b: string) => a !== b && visible.has(a) && visible.has(b);

  const edges: GraphEdge[] = [];
  const edge = (e: Partial<GraphEdge> & Pick<GraphEdge, "id" | "type" | "source" | "target">): void => {
    edges.push({ label: null, inverseLabel: null, twoWay: false, note: null, visibility: null, ...e });
  };

  // Relations — the curated edges.
  const rel = visibleRelationsSql(viewer);
  const relations = db
    .prepare(
      `SELECT r.id, r.source_node_id, r.target_node_id, r.label, r.inverse_label, r.two_way, r.note, r.visibility
       FROM relations r JOIN nodes s ON s.id = r.source_node_id JOIN nodes t ON t.id = r.target_node_id
       WHERE r.world_id = ? AND ${rel.sql}`,
    )
    .all(worldId, ...rel.params) as {
    id: string;
    source_node_id: string;
    target_node_id: string;
    label: string;
    inverse_label: string | null;
    two_way: number;
    note: string;
    visibility: GraphEdge["visibility"];
  }[];
  for (const r of relations) {
    if (!both(r.source_node_id, r.target_node_id)) continue;
    edge({
      id: `relation:${r.id}`,
      type: "relation",
      source: r.source_node_id,
      target: r.target_node_id,
      label: r.label,
      inverseLabel: r.inverse_label,
      twoWay: r.two_way === 1,
      note: r.note.length > 0 ? r.note : null,
      visibility: r.visibility,
    });
  }

  // Link-type fields — relations that came with a template.
  const levels = readableLevels(viewer.role).filter((l) => l !== "private");
  const fields = db
    .prepare(
      `SELECT f.id, f.node_id, f.key, f.value_ref, f.visibility, n.template_id FROM fields f
       JOIN nodes n ON n.id = f.node_id
       WHERE n.world_id = ? AND f.type = 'link' AND f.value_ref IS NOT NULL
         AND f.visibility IN (${levels.map(() => "?").join(", ")})`,
    )
    .all(worldId, ...levels) as {
    id: string;
    node_id: string;
    key: string;
    value_ref: string;
    visibility: GraphEdge["visibility"];
    template_id: string | null;
  }[];
  const defsCache = new Map<string | null, ReturnType<typeof defsByKey>>();
  for (const f of fields) {
    if (!both(f.node_id, f.value_ref)) continue;
    if (!defsCache.has(f.template_id)) defsCache.set(f.template_id, defsByKey(f.template_id));
    const label = defsCache.get(f.template_id)!.get(f.key)?.label ?? f.key;
    edge({ id: `field:${f.id}`, type: "field", source: f.node_id, target: f.value_ref, label, visibility: f.visibility });
  }

  // Wiki links — ambient. One edge per ordered pair, however many times it's linked.
  const links = db
    .prepare("SELECT DISTINCT src_node_id, dst_node_id FROM links WHERE world_id = ? AND dst_node_id IS NOT NULL")
    .all(worldId) as { src_node_id: string; dst_node_id: string }[];
  for (const l of links) {
    if (both(l.src_node_id, l.dst_node_id)) {
      edge({ id: `link:${l.src_node_id}:${l.dst_node_id}`, type: "link", source: l.src_node_id, target: l.dst_node_id });
    }
  }

  // "Placed on": a map to each page it has a pin for — only pins this viewer
  // would actually be sent, so fog and marker visibility apply.
  const maps = db
    .prepare(
      `SELECT DISTINCT m.map_node_id FROM map_markers m JOIN nodes n ON n.id = m.map_node_id
       WHERE n.world_id = ? AND m.target_node_id IS NOT NULL`,
    )
    .all(worldId) as { map_node_id: string }[];
  for (const { map_node_id: mapId } of maps) {
    if (!visible.has(mapId)) continue;
    const counts = new Map<string, number>();
    for (const marker of listMarkers(mapId, viewer)) {
      const target = marker.targetNode?.id;
      if (target !== undefined && both(mapId, target)) counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    for (const [target, count] of counts) {
      edge({ id: `map:${mapId}:${target}`, type: "map", source: mapId, target, label: count > 1 ? `${count} pins` : null });
    }
  }

  // Structure.
  for (const r of rows) {
    if (r.parent_id !== null && both(r.parent_id, r.id)) {
      edge({ id: `parent:${r.id}`, type: "parent", source: r.parent_id, target: r.id });
    }
  }

  let keep: Set<string> = visible;
  if (focus !== undefined && visible.has(focus)) {
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      if (e.type === "parent") continue;
      adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
      adjacency.set(e.target, [...(adjacency.get(e.target) ?? []), e.source]);
    }
    keep = new Set([focus]);
    let frontier = [focus];
    for (let step = 0; step < depth; step += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbor of adjacency.get(id) ?? []) {
          if (!keep.has(neighbor)) {
            keep.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
  } else if (focus !== undefined) {
    keep = new Set();
  }

  const degree = new Map<string, number>();
  for (const e of edges) {
    if (e.type === "parent") continue;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  let truncated = false;
  if (keep.size > GRAPH_MAX_NODES) {
    truncated = true;
    keep = new Set([...keep].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0)).slice(0, GRAPH_MAX_NODES));
  }

  const tagRows = db
    .prepare("SELECT nt.node_id, nt.tag_id FROM node_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.world_id = ?")
    .all(worldId) as { node_id: string; tag_id: string }[];
  const tagsByNode = new Map<string, string[]>();
  for (const t of tagRows) {
    if (keep.has(t.node_id)) tagsByNode.set(t.node_id, [...(tagsByNode.get(t.node_id) ?? []), t.tag_id]);
  }

  const nodes: GraphNode[] = rows
    .filter((r) => keep.has(r.id))
    .map((r) => ({
      id: r.id,
      title: r.title,
      icon: r.icon,
      kind: r.kind,
      effectiveVisibility: r.effective_visibility,
      tagIds: tagsByNode.get(r.id) ?? [],
      parentId: r.parent_id,
      degree: degree.get(r.id) ?? 0,
    }));
  const usedTags = new Set(nodes.flatMap((n) => n.tagIds));
  const tags = (db.prepare("SELECT id, name, color FROM tags WHERE world_id = ? ORDER BY name").all(worldId) as {
    id: string;
    name: string;
    color: string | null;
  }[]).filter((t) => usedTags.has(t.id));

  return {
    nodes,
    edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    tags,
    truncated,
  };
}
