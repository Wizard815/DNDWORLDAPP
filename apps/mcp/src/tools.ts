import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { visibilitySchema } from "@dndworldapp/schema";
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

/** Renders the tree as indented lines — far cheaper for a model to read than JSON. */
function renderTree(nodes: NodeSummary[]): string {
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
      const marks = [node.kind !== "document" ? node.kind : null, node.visibility !== "members" ? node.visibility : null]
        .filter(Boolean)
        .join(", ");
      lines.push(`${"  ".repeat(depth)}- ${node.title} [${node.id}]${marks ? ` (${marks})` : ""}`);
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
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

  // -------------------------------------------------------------------------
  // Declared but not built yet — visible on purpose, so the shape is known.
  // -------------------------------------------------------------------------

  const notYet = (phase: string, what: string) => ({
    title: what,
    description: `Not implemented yet — ${phase}. The tool exists so the eventual shape is visible.`,
    inputSchema: {},
  });

  for (const [name, phase, label] of [
    ["place_marker", "arrives in P4 with maps", "Place a map marker"],
    ["add_event", "arrives in P5 with calendars", "Add a timeline event"],
    ["advance_calendar", "arrives in P5 with calendars", "Advance the world's current date"],
  ] as const) {
    server.registerTool(name, notYet(phase, label), async () =>
      text(`${label} is not implemented yet — it ${phase}.`),
    );
  }
}
