import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WorldClient } from "./client.ts";
import { registerTools } from "./tools.ts";

/**
 * MCP server for DNDWORLDAPP.
 *
 * A thin adapter over the app's public HTTP API — it holds a bearer token and
 * nothing else. It has no database access and no privileged path, so whatever the
 * token's owner may see and do is exactly what this server may see and do.
 *
 * Configure with:
 *   DNDWORLDAPP_URL     e.g. http://localhost:8080  (default)
 *   DNDWORLDAPP_TOKEN   a token from the app's "API tokens" panel  (required)
 *   DNDWORLDAPP_WORLD   optional world id, when the token reaches several
 */

const baseUrl = process.env.DNDWORLDAPP_URL ?? "http://localhost:8080";
const token = process.env.DNDWORLDAPP_TOKEN;
const worldId = process.env.DNDWORLDAPP_WORLD ?? null;

if (token === undefined || token.length === 0) {
  process.stderr.write(
    [
      "DNDWORLDAPP_TOKEN is not set.",
      "",
      "Mint one in the app: sidebar footer -> API tokens -> name it, choose",
      "'Read + write', and leave it pinned to a single world. The secret is",
      "shown once.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const client = new WorldClient({ baseUrl, token, worldId });

const server = new McpServer(
  { name: "dndworldapp", version: "0.1.0" },
  {
    instructions: [
      "DNDWORLDAPP is a self-hosted worldbuilding and campaign app.",
      "",
      "Everything is a page in one freeform tree — anything nests inside anything,",
      "and a page with children is the folder. Pages link to each other with",
      "[[Double Brackets]]; a link to a page that does not exist yet is fine and",
      "resolves itself the moment that page is written.",
      "",
      "Sections on a page carry their own visibility. This is how a player-facing",
      "location page holds DM-only notes. When you write anything the players must",
      "not read, put it in a section with visibility 'dm' — never in the page body.",
      "",
      "Start with get_tree to see the world's shape, or find_nodes to search it.",
    ].join("\n"),
  },
);

registerTools(server, client);

await server.connect(new StdioServerTransport());

// stdout belongs to the protocol; anything human-readable goes to stderr.
process.stderr.write(`dndworldapp-mcp connected to ${baseUrl}\n`);
