import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fieldVisibilitySchema, markerShapeSchema, visibilitySchema } from "@dndworldapp/schema";
import type { NodeSummary } from "@dndworldapp/schema";
import { ApiError, type WorldClient } from "./client.ts";

/**
 * Tools mirror the domain, not the tables, and deliberately echo the shape of the
 * Kanka MCP the owner already uses daily, so habits transfer.
 *
 * Everything goes through the HTTP API, so the server's visibility rules apply
 * unchanged: a token pinned to a player-level account simply cannot see DM notes,
 * and no tool can widen that.
 */

const worldIdArg = z
  .string()
  .optional()
  .describe("World id. Optional when the token is pinned to one world, or you only have one.");

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function fail(error: unknown) {
  const message =
    error instanceof ApiError
      ? `${error.message} (${error.code}, HTTP ${error.status})`
      : error instanceof Error
        ? error.message
        : String(error);
  return { content: [{ type: "text" as const, text: `Failed: ${message}` }], isError: true };
}

function nodeLine(node: NodeSummary, depth: number): string {
  const marks = [node.kind !== "document" ? node.kind : null, node.visibility !== "members" ? node.visibility : null]
    .filter(Boolean)
    .join(", ");
  return `${"  ".repeat(depth)}- ${node.title} [${node.id}]${marks ? ` (${marks})` : ""}`;
}

/**
 * Renders a tree (or, given `rootId`, just one page's descendant hierarchy) as
 * indented lines — far cheaper for a model to read than JSON. `nodes` is always the
 * whole world's tree; filtering to one page's subtree happens here, not server-side,
 * since GET .../tree already returns everything the viewer may see in one call.
 */
function renderTree(nodes: NodeSummary[], rootId: string | null = null): string {
  const byParent = new Map<string | null, NodeSummary[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));

  const lines: string[] = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const node of byParent.get(parentId) ?? []) {
      lines.push(nodeLine(node, depth));
      walk(node.id, depth + 1);
    }
  };

  if (rootId === null) {
    walk(null, 0);
  } else {
    const root = nodes.find((n) => n.id === rootId);
    if (root !== undefined) lines.push(nodeLine(root, 0));
    walk(rootId, 1);
  }
  return lines.join("\n");
}

export function registerTools(server: McpServer, client: WorldClient): void {
  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  server.registerTool(
    "list_worlds",
    {
      title: "List worlds",
      description: "Worlds this token can reach, with each one's root page id.",
      inputSchema: {},
    },
    async () => {
      try {
        const { worlds } = await client.listWorlds();
        if (worlds.length === 0) return text("This token can reach no worlds.");
        return text(
          worlds
            .map((w) => `${w.name} [${w.id}] — your role: ${w.role}, root page: ${w.rootNodeId ?? "none"}`)
            .join("\n"),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_tree",
    {
      title: "Get the page tree",
      description:
        "The whole visible tree as an indented outline. Anything nests inside anything, so this is the map of the world. Pages you may not see are simply absent.",
      inputSchema: { world_id: worldIdArg },
    },
    async ({ world_id }) => {
      try {
        const worldId = await client.resolveWorldId(world_id);
        const { nodes } = await client.tree(worldId);
        if (nodes.length === 0) return text("This world has no pages yet.");
        return text(`${nodes.length} pages:\n\n${renderTree(nodes)}`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_subtree",
    {
      title: "Get one page's descendant hierarchy",
      description:
        "The pages nested under one page — its children, their children, and so on — as an indented outline, without pulling in the rest of the world. Use this after find_nodes/get_tree has located a page (e.g. a family, faction, or region) to see just the hierarchy underneath it.",
      inputSchema: { node_id: z.string().describe("The page to root the outline at.") },
    },
    async ({ node_id }) => {
      try {
        const { node } = await client.node(node_id);
        const { nodes } = await client.tree(node.worldId);
        const outline = renderTree(nodes, node_id);
        const hasChildren = outline.includes("\n");
        return text(hasChildren ? outline : `"${node.title}" [${node.id}] has no pages inside it.`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "find_nodes",
    {
      title: "Find pages",
      description:
        "Full-text search over page titles and bodies. Each word matches as a prefix. Returns ids you can pass to get_node.",
      inputSchema: {
        query: z.string().min(1).describe("What to search for."),
        world_id: worldIdArg,
        limit: z.number().int().min(1).max(100).optional().describe("Default 25."),
      },
    },
    async ({ query, world_id, limit }) => {
      try {
        const worldId = await client.resolveWorldId(world_id);
        const { hits } = await client.search(worldId, query, limit ?? 25);
        if (hits.length === 0) return text(`Nothing matched "${query}".`);
        return text(
          hits
            .map((h) => `${h.title} [${h.nodeId}]\n    ${h.snippet.replace(/<\/?mark>/g, "**")}`)
            .join("\n"),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_node",
    {
      title: "Get a page",
      description:
        "A page's markdown body, plus its breadcrumb, the pages inside it, and what links to it. Use include_posts to also fetch its sections. " +
        "Any :::secret ... ::: block only appears in the response if this token's owner is a DM — a player-level token receives the body with those blocks already removed.",
      inputSchema: {
        node_id: z.string().describe("The page id, e.g. ox9119wx."),
        include_posts: z.boolean().optional().describe("Also fetch the page's sections. Default true."),
      },
    },
    async ({ node_id, include_posts }) => {
      try {
        const { node } = await client.node(node_id);
        const parts = [
          `# ${node.title} [${node.id}]`,
          `kind: ${node.kind} · visibility: ${node.visibility} · editable: ${node.canEdit}`,
          node.breadcrumb.length > 0
            ? `path: ${[...node.breadcrumb.map((c) => c.title), node.title].join(" / ")}`
            : "path: (root)",
          "",
          node.bodyMd.trim().length > 0 ? node.bodyMd : "_(empty page)_",
        ];

        if (include_posts !== false) {
          const { posts } = await client.posts(node_id);
          if (posts.length > 0) {
            parts.push("", "## Sections");
            for (const post of posts) {
              parts.push(
                "",
                `### ${post.title || "(untitled)"} [${post.id}] — visibility: ${post.visibility}`,
                post.bodyMd,
              );
            }
          }
        }

        const { fields } = await client.fields(node_id);
        if (fields.length > 0) {
          parts.push(
            "",
            "## Fields",
            ...fields.map((f) => {
              if (f.type === "section") return `--- ${f.label} ---`;
              const value = f.type === "link" && f.refNode !== null && f.refNode !== undefined
                ? `${f.refNode.title} [${f.refNode.id}]`
                : String(f.value ?? "(empty)");
              const vis = f.visibility !== "members" ? ` (${f.visibility})` : "";
              return `- ${f.label}: ${value}${vis}`;
            }),
          );
        }

        if (node.children.length > 0) {
          parts.push("", `## Pages inside`, ...node.children.map((c) => `- ${c.title} [${c.id}]`));
        }
        if (node.backlinks.length > 0) {
          parts.push("", `## Linked from`, ...node.backlinks.map((b) => `- ${b.title} [${b.nodeId}]`));
        }
        return text(parts.join("\n"));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_templates",
    {
      title: "List field templates",
      description:
        "This world's field-definition templates — each a named, ordered list of typed fields (see set_node_template / set_field to use one).",
      inputSchema: { world_id: worldIdArg },
    },
    async ({ world_id }) => {
      try {
        const worldId = await client.resolveWorldId(world_id);
        const { templates } = await client.templates(worldId);
        if (templates.length === 0) return text("This world has no templates yet.");
        return text(
          templates
            .map((t) => {
              const fields = t.fieldSchema.map((f) => `${f.key} (${f.type})`).join(", ");
              return `${t.icon ?? ""} ${t.name} [${t.id}]${fields.length > 0 ? ` — ${fields}` : ""}`;
            })
            .join("\n"),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_unresolved_links",
    {
      title: "List wanted pages",
      description:
        "Wiki links that point at pages nobody has written yet. A to-do list for the world.",
      inputSchema: { world_id: worldIdArg },
    },
    async ({ world_id }) => {
      try {
        const worldId = await client.resolveWorldId(world_id);
        const { links } = await client.unresolvedLinks(worldId);
        if (links.length === 0) return text("Every wiki link resolves. Nothing wanted.");
        return text(links.map((l) => `${l.targetText} — linked ${l.count}×`).join("\n"));
      } catch (error) {
        return fail(error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Writing
  // -------------------------------------------------------------------------

  server.registerTool(
    "create_node",
    {
      title: "Create a page",
      description:
        "Create a page anywhere in the tree. Link to other pages from the body with [[Double Brackets]] — a link to a page that does not exist yet is fine and resolves itself later. " +
        "For a DM-only aside inside otherwise player-visible prose, wrap it in a :::secret ... ::: block on its own lines — the server strips it out of anything a non-DM viewer receives, so it never reaches a player, even through search.",
      inputSchema: {
        title: z.string().min(1).max(300),
        world_id: worldIdArg,
        parent_id: z.string().nullable().optional().describe("Page to nest under. Omit for top level."),
        body_md: z.string().optional().describe("Markdown body."),
        icon: z.string().optional().describe("A single emoji."),
        visibility: visibilitySchema.optional().describe("public | members | dm | private. Default members."),
      },
    },
    async ({ title, world_id, parent_id, body_md, icon, visibility }) => {
      try {
        const worldId = await client.resolveWorldId(world_id);
        const { node } = await client.createNode(worldId, {
          title,
          parentId: parent_id ?? null,
          bodyMd: body_md,
          icon: icon ?? null,
          visibility,
        });
        return text(`Created "${node.title}" [${node.id}].`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_node",
    {
      title: "Update a page",
      description:
        "Change a page's title, body, icon or visibility. The body is replaced wholesale, so read it first with get_node if you mean to append. " +
        "Use :::secret ... ::: for a DM-only aside inside the body (see create_node). If the page already has one and you are not signed in as a DM, a body edit is rejected outright rather than risk silently deleting content you cannot see.",
      inputSchema: {
        node_id: z.string(),
        title: z.string().min(1).max(300).optional(),
        body_md: z.string().optional(),
        icon: z.string().nullable().optional(),
        visibility: visibilitySchema.optional(),
      },
    },
    async ({ node_id, title, body_md, icon, visibility }) => {
      try {
        const { node } = await client.updateNode(node_id, {
          title,
          bodyMd: body_md,
          icon,
          visibility,
        });
        return text(`Updated "${node.title}" [${node.id}].`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "move_node",
    {
      title: "Move a page",
      description:
        "Re-parent a page, and optionally place it between two siblings. Moving a page inside its own descendant is rejected.",
      inputSchema: {
        node_id: z.string(),
        parent_id: z.string().nullable().describe("New parent, or null for top level."),
        after_id: z.string().nullable().optional().describe("Sibling it should follow."),
        before_id: z.string().nullable().optional().describe("Sibling it should precede."),
      },
    },
    async ({ node_id, parent_id, after_id, before_id }) => {
      try {
        const { node } = await client.moveNode(node_id, {
          parentId: parent_id,
          afterId: after_id ?? null,
          beforeId: before_id ?? null,
        });
        return text(`Moved [${node.id}] under ${node.parentId ?? "the top level"}.`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "archive_node",
    {
      title: "Archive a page",
      description: "Archive a page and everything inside it. Not a hard delete, but it leaves the tree.",
      inputSchema: { node_id: z.string() },
    },
    async ({ node_id }) => {
      try {
        await client.archiveNode(node_id);
        return text(`Archived [${node_id}] and everything inside it.`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "create_post",
    {
      title: "Add a section to a page",
      description:
        "Sections carry their own visibility, which is how a player-facing page holds a whole DM-only block. Use visibility 'dm' to hide the entire section. " +
        "For a shorter aside inside an otherwise player-visible section, wrap just that part in :::secret ... ::: instead (see create_node) — the finer-grained tool, and the one actually reached for most in practice.",
      inputSchema: {
        node_id: z.string(),
        title: z.string().max(300).optional(),
        body_md: z.string().optional(),
        visibility: visibilitySchema.optional().describe("Default members. Use 'dm' for DM notes."),
      },
    },
    async ({ node_id, title, body_md, visibility }) => {
      try {
        const { post } = await client.createPost(node_id, {
          title: title ?? "",
          bodyMd: body_md ?? "",
          visibility: visibility ?? "members",
        });
        return text(`Added section "${post.title || "(untitled)"}" [${post.id}] — visibility ${post.visibility}.`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_post",
    {
      title: "Update a section",
      description:
        "Change a section's title, body or visibility. Same :::secret ... ::: rule and edit guard as update_node.",
      inputSchema: {
        post_id: z.string(),
        title: z.string().max(300).optional(),
        body_md: z.string().optional(),
        visibility: visibilitySchema.optional(),
      },
    },
    async ({ post_id, title, body_md, visibility }) => {
      try {
        const { post } = await client.updatePost(post_id, { title, bodyMd: body_md, visibility });
        return text(`Updated section [${post.id}] — visibility ${post.visibility}.`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "set_node_template",
    {
      title: "Assign a field template to a page",
      description:
        "Assigns a template, instantiating a blank/default field for each of its definitions the page doesn't already have (by key) — never disturbs a field already there. Pass template_id null to clear it (already-instantiated fields are untouched).",
      inputSchema: {
        node_id: z.string(),
        template_id: z.string().nullable().describe("From list_templates. Null clears the page's template."),
      },
    },
    async ({ node_id, template_id }) => {
      try {
        const { node } = await client.updateNode(node_id, { templateId: template_id });
        return text(`"${node.title}" [${node.id}] now uses template ${node.templateId ?? "(none)"}.`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "set_field",
    {
      title: "Set a field's value on a page",
      description:
        "The ergonomic way to write a typed field: matches an existing field on the page by key and updates its value, or creates a new ad hoc one if no field with that key exists yet. The field's type is inferred from the JS value's type (string/number/boolean) when creating.",
      inputSchema: {
        node_id: z.string(),
        key: z.string().describe("The field's key, as shown by get_node's Fields section or list_templates."),
        value: z
          .union([z.string(), z.number(), z.boolean(), z.null()])
          .describe("For a link field, pass the target page's id as a string."),
      },
    },
    async ({ node_id, key, value }) => {
      try {
        const { fields } = await client.fields(node_id);
        const existing = fields.find((f) => f.key === key);
        if (existing !== undefined) {
          const { field } = await client.updateField(node_id, existing.id, { value });
          return text(`Set ${field.label} = ${String(field.value ?? "(empty)")} on [${node_id}].`);
        }
        const type = typeof value === "boolean" ? "checkbox" : typeof value === "number" ? "number" : "text";
        const { field } = await client.createField(node_id, { key, type, value, visibility: "members" });
        return text(`Added field ${field.label} = ${String(field.value ?? "(empty)")} on [${node_id}].`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "delete_field",
    {
      title: "Delete a field",
      description:
        "Remove a field from a page by key, whether it was ad hoc or came from a template. Does not touch the template itself, and does not affect other pages using it.",
      inputSchema: {
        node_id: z.string(),
        key: z.string().describe("The field's key, as shown by get_node's Fields section."),
      },
    },
    async ({ node_id, key }) => {
      try {
        const { fields } = await client.fields(node_id);
        const field = fields.find((f) => f.key === key);
        if (field === undefined) return text(`No field with key "${key}" on [${node_id}].`);
        await client.deleteField(node_id, field.id);
        return text(`Deleted field "${key}" from [${node_id}].`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "apply_template",
    {
      title: "Re-apply a page's template",
      description:
        "Backfills any of the page's template fields it is missing (by key), without disturbing values already set. Use after editing a template's schema to push new fields onto pages that assigned it earlier. Fails if the page has no template.",
      inputSchema: { node_id: z.string() },
    },
    async ({ node_id }) => {
      try {
        const { fields } = await client.applyTemplate(node_id);
        return text(`[${node_id}] now has ${fields.length} field(s).`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_map",
    {
      title: "Get a page's map",
      description:
        "A map page's source image, pixel bounds, and every marker on it (shape, position, linked page if any) in one call.",
      inputSchema: { node_id: z.string().describe("The map page's id.") },
    },
    async ({ node_id }) => {
      try {
        const { map } = await client.map(node_id);
        const { markers } = await client.mapMarkers(node_id);
        const parts = [
          `Map on [${node_id}]: ${map.width}x${map.height}px, zoom ${map.minZoom}-${map.maxZoom}, tiling: ${map.tilingStatus}`,
        ];
        if (markers.length === 0) {
          parts.push("No markers yet.");
        } else {
          parts.push(
            "",
            "Markers:",
            ...markers.map((m) => {
              const target = m.targetNode !== null ? ` -> [${m.targetNode.id}]` : "";
              const vis = m.visibility !== "members" ? ` (${m.visibility})` : "";
              return `- [${m.id}] ${m.shape} "${m.label ?? "(untitled)"}" at (${m.x}, ${m.y})${target}${vis}`;
            }),
          );
        }
        return text(parts.join("\n"));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "place_marker",
    {
      title: "Place a marker on a map",
      description:
        "Add a pin, label, circle, region polygon, or party/army token to a map page. A marker linked via target_node_id shows that page's title/icon unless label/icon are set explicitly.",
      inputSchema: {
        node_id: z.string().describe("The map page's id."),
        shape: markerShapeSchema.optional().describe("Default 'pin'."),
        x: z.number().describe("Pixel x position, in the map image's own pixel space."),
        y: z.number().describe("Pixel y position."),
        target_node_id: z.string().nullable().optional().describe("A page this marker links to and inherits title/icon from."),
        label: z.string().optional().describe("Overrides the linked page's title, or names an unlinked marker."),
        icon: z.string().optional().describe("A single emoji, overriding the linked page's icon."),
        color: z.string().optional(),
        members: z.string().optional().describe("Token markers only: freeform description of who's in this group."),
        visibility: fieldVisibilitySchema.optional().describe("public | members | dm. Default members."),
      },
    },
    async ({ node_id, shape, x, y, target_node_id, label, icon, color, members, visibility }) => {
      try {
        const { marker } = await client.createMarker(node_id, {
          shape: shape ?? "pin",
          x,
          y,
          targetNodeId: target_node_id,
          label,
          icon,
          color,
          members,
          visibility: visibility ?? "members",
        });
        return text(`Placed ${marker.shape} marker [${marker.id}] at (${marker.x}, ${marker.y}) on [${node_id}].`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "update_marker",
    {
      title: "Update a marker",
      description: "Change a marker's position, links, overrides, or visibility. Use the id from get_map or place_marker.",
      inputSchema: {
        marker_id: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        target_node_id: z.string().nullable().optional(),
        label: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
        color: z.string().nullable().optional(),
        members: z.string().nullable().optional(),
        visibility: fieldVisibilitySchema.optional(),
      },
    },
    async ({ marker_id, ...input }) => {
      try {
        const { marker } = await client.updateMarker(marker_id, input);
        return text(`Updated marker [${marker.id}].`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "delete_marker",
    {
      title: "Delete a marker",
      description: "Remove a marker from its map. Use the id from get_map or place_marker.",
      inputSchema: { marker_id: z.string() },
    },
    async ({ marker_id }) => {
      try {
        await client.deleteMarker(marker_id);
        return text(`Deleted marker [${marker_id}].`);
      } catch (error) {
        return fail(error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // Declared but not built yet — visible on purpose, so the shape is known.
  // -------------------------------------------------------------------------

  const notYet = (phase: string, what: string) => ({
    title: what,
    description: `Not implemented yet — ${phase}. The tool exists so the eventual shape is visible.`,
    inputSchema: {},
  });

  for (const [name, phase, label] of [
    ["add_event", "arrives in P5 with calendars", "Add a timeline event"],
    ["advance_calendar", "arrives in P5 with calendars", "Advance the world's current date"],
  ] as const) {
    server.registerTool(name, notYet(phase, label), async () =>
      text(`${label} is not implemented yet — it ${phase}.`),
    );
  }
}
