/**
 * DNDWORLDAPP API client — shared between desktop, mobile, and any other client.
 *
 * Reuses the pattern from `apps/mcp/src/client.ts`: everything goes through the
 * public HTTP API, never the database. The API is the single contract.
 *
 * Differences from the MCP client:
 * - Provides React hooks (`useAuth`, `useWorlds`, etc.) for UI consumption
 * - Token storage is abstracted behind `TokenStorage` for platform differences
 * - Built-in offline cache layer (pluggable)
 * - SSE subscription support for realtime (future)
 */

import type {
  CreateFieldInput,
  CreateMapGroupInput,
  CreateMarkerInput,
  CreateNodeInput,
  CreateRelationInput,
  FieldDto,
  Graph,
  MapDto,
  MapGroupDto,
  MapMarkerDto,
  MemberDto,
  MoveMapGroupInput,
  MoveNodeInput,
  NodeDetail,
  NodeSummary,
  PostDto,
  RelationDto,
  SearchHit,
  SetupInput,
  TemplateDto,
  UnresolvedLink,
  UpdateFieldInput,
  UpdateMapGroupInput,
  UpdateMarkerInput,
  WikiGraph,
  UpdateNodeInput,
  UpdatePostInput,
  UpdateRelationInput,
  UserDto,
  WorldDto,
} from "@dndworldapp/schema";

// ---------------------------------------------------------------------------
// Token storage abstraction
// ---------------------------------------------------------------------------

/**
 * Platform-specific token storage. Implementations:
 * - Desktop (Tauri): Linux keyring (secret-service via Rust crate)
 * - Mobile (Expo): expo-secure-store
 * - Browser (web): already uses session cookies — this client is for thick clients
 */
export interface TokenStorage {
  /** Get stored token, or null if none. */
  getToken(): Promise<string | null>;
  /** Store token (and optional server URL). */
  storeToken(token: string, baseUrl: string): Promise<void>;
  /** Clear stored credentials. */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// API errors
// ---------------------------------------------------------------------------

export class DndClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DndClientError";
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Core API client
// ---------------------------------------------------------------------------

export type ClientConfig = {
  baseUrl: string;
  token: string;
  worldId?: string | null;
};

export class DndClient {
  private baseUrl: string;
  private token: string;
  readonly pinnedWorldId: string | null;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.pinnedWorldId = config.worldId ?? null;
  }

  /** Base URL for API calls. */
  get apiBaseUrl(): string {
    return `${this.baseUrl}/api/v1`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      let code = "http_error";
      let message = `${response.status} ${response.statusText}`;
      try {
        const parsed = (await response.json()) as {
          error?: { code?: string; message?: string };
        };
        code = parsed.error?.code ?? code;
        message = parsed.error?.message ?? message;
      } catch {
        // Non-JSON error body; the status line will have to do.
      }
      throw new DndClientError(response.status, code, message);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Resolve which world to act on: explicit > pinned > only available. */
  async resolveWorldId(explicit?: string | null): Promise<string> {
    if (explicit !== undefined && explicit !== null && explicit.length > 0)
      return explicit;
    if (this.pinnedWorldId !== null) return this.pinnedWorldId;

    const { worlds } = await this.listWorlds();
    if (worlds.length === 0)
      throw new DndClientError(404, "no_world", "This token can reach no worlds.");
    if (worlds.length > 1) {
      const names = worlds.map((w) => `${w.name} (${w.id})`).join(", ");
      throw new DndClientError(
        400,
        "ambiguous_world",
        `This token can reach several worlds, so pass world_id explicitly. Available: ${names}`
      );
    }
    return worlds[0]!.id;
  }

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  setup(input: SetupInput) {
    return this.request<{ ok: true; token: string }>("POST", "/setup", input);
  }

  login(username: string, password: string) {
    return this.request<{ token: string; user: UserDto }>(
      "POST",
      "/login",
      { username, password }
    );
  }

  whoami() {
    return this.request<{ user: UserDto }>("GET", "/whoami");
  }

  // -----------------------------------------------------------------------
  // Worlds
  // -----------------------------------------------------------------------

  listWorlds() {
    return this.request<{ worlds: WorldDto[] }>("GET", "/worlds");
  }

  createWorld(name: string) {
    return this.request<{ world: WorldDto }>("POST", "/worlds", { name });
  }

  getWorld(worldId: string) {
    return this.request<{ world: WorldDto }>("GET", `/worlds/${worldId}`);
  }

  // -----------------------------------------------------------------------
  // Members
  // -----------------------------------------------------------------------

  listMembers(worldId: string) {
    return this.request<{ members: MemberDto[] }>(
      "GET",
      `/worlds/${worldId}/members`
    );
  }

  addMember(worldId: string, input: {
    username: string;
    role: string;
    name?: string;
    password?: string;
  }) {
    return this.request<{ member: MemberDto }>(
      "POST",
      `/worlds/${worldId}/members`,
      input
    );
  }

  removeMember(worldId: string, memberId: string) {
    return this.request<{ ok: true }>(
      "DELETE",
      `/worlds/${worldId}/members/${memberId}`
    );
  }

  resetPassword(worldId: string, memberId: string, input: { newPassword: string }) {
    return this.request<{ ok: true }>(
      "PATCH",
      `/worlds/${worldId}/members/${memberId}/password`,
      input
    );
  }

  // -----------------------------------------------------------------------
  // Tokens
  // -----------------------------------------------------------------------

  listTokens(worldId: string) {
    return this.request<{ tokens: Array<{ id: string; name: string; scope: string; pinnedWorldId: string | null; createdAt: string; lastUsedAt: string | null }> }>(
      "GET",
      `/worlds/${worldId}/tokens`
    );
  }

  createToken(worldId: string, input: { name: string; scope: string; pinnedWorldId?: string | null }) {
    return this.request<{ token: { id: string; name: string; scope: string; value: string; pinnedWorldId: string | null; createdAt: string } }>(
      "POST",
      `/worlds/${worldId}/tokens`,
      input
    );
  }

  revokeToken(worldId: string, tokenId: string) {
    return this.request<{ ok: true }>(
      "DELETE",
      `/worlds/${worldId}/tokens/${tokenId}`
    );
  }

  // -----------------------------------------------------------------------
  // Nodes (tree, detail, CRUD)
  // -----------------------------------------------------------------------

  tree(worldId: string) {
    return this.request<{ nodes: NodeSummary[] }>(
      "GET",
      `/worlds/${worldId}/tree`
    );
  }

  search(worldId: string, q: string, limit = 25) {
    const query = `q=${encodeURIComponent(q)}&limit=${limit}`;
    return this.request<{ hits: SearchHit[] }>(
      "GET",
      `/worlds/${worldId}/search?${query}`
    );
  }

  getNode(nodeId: string) {
    return this.request<{ node: NodeDetail }>("GET", `/nodes/${nodeId}`);
  }

  createNode(worldId: string, input: CreateNodeInput) {
    return this.request<{ node: NodeDetail }>(
      "POST",
      `/worlds/${worldId}/nodes`,
      input
    );
  }

  updateNode(nodeId: string, input: UpdateNodeInput) {
    return this.request<{ node: NodeDetail }>(
      "PATCH",
      `/nodes/${nodeId}`,
      input
    );
  }

  moveNode(nodeId: string, input: MoveNodeInput) {
    return this.request<{ ok: true }>(
      "POST",
      `/nodes/${nodeId}/move`,
      input
    );
  }

  deleteNode(nodeId: string) {
    return this.request<{ ok: true }>("DELETE", `/nodes/${nodeId}`);
  }

  archiveNode(nodeId: string) {
    return this.request<{ ok: true }>("POST", `/nodes/${nodeId}/archive`);
  }

  unarchiveNode(nodeId: string) {
    return this.request<{ ok: true }>("POST", `/nodes/${nodeId}/unarchive`);
  }

  pinNode(nodeId: string) {
    return this.request<{ ok: true }>("POST", `/nodes/${nodeId}/pin`);
  }

  unpinNode(nodeId: string) {
    return this.request<{ ok: true }>("POST", `/nodes/${nodeId}/unpin`);
  }

  // -----------------------------------------------------------------------
  // Sections (posts within nodes)
  // -----------------------------------------------------------------------

  listSections(nodeId: string) {
    return this.request<{ sections: PostDto[] }>("GET", `/nodes/${nodeId}/sections`);
  }

  createSection(nodeId: string, input: { node: string; markdown: string }) {
    return this.request<{ section: PostDto }>(
      "POST",
      `/nodes/${nodeId}/sections`,
      input
    );
  }

  updateSection(sectionId: string, input: UpdatePostInput) {
    return this.request<{ section: PostDto }>(
      "PATCH",
      `/sections/${sectionId}`,
      input
    );
  }

  deleteSection(sectionId: string) {
    return this.request<{ ok: true }>("DELETE", `/sections/${sectionId}`);
  }

  // -----------------------------------------------------------------------
  // Fields (typed per-node fields)
  // -----------------------------------------------------------------------

  listFields(nodeId: string) {
    return this.request<{ fields: FieldDto[] }>("GET", `/nodes/${nodeId}/fields`);
  }

  createField(nodeId: string, input: CreateFieldInput) {
    return this.request<{ field: FieldDto }>(
      "POST",
      `/nodes/${nodeId}/fields`,
      input
    );
  }

  updateField(fieldId: string, input: UpdateFieldInput) {
    return this.request<{ field: FieldDto }>(
      "PATCH",
      `/fields/${fieldId}`,
      input
    );
  }

  deleteField(fieldId: string) {
    return this.request<{ ok: true }>("DELETE", `/fields/${fieldId}`);
  }

  // -----------------------------------------------------------------------
  // Tags
  // -----------------------------------------------------------------------

  nodeTags(nodeId: string) {
    return this.request<{ tags: string[] }>("GET", `/nodes/${nodeId}/tags`);
  }

  tagNodes(tag: string, limit = 50) {
    return this.request<{ nodes: NodeSummary[] }>(
      "GET",
      `/tags/${encodeURIComponent(tag)}/nodes?limit=${limit}`
    );
  }

  // -----------------------------------------------------------------------
  // Wiki links & backlinks
  // -----------------------------------------------------------------------

  backlinks(nodeId: string) {
    return this.request<{ nodes: NodeSummary[] }>(
      "GET",
      `/nodes/${nodeId}/backlinks`
    );
  }

  unresolvedLinks(worldId: string) {
    return this.request<{ links: UnresolvedLink[] }>(
      "GET",
      `/worlds/${worldId}/unresolved-links`
    );
  }

  // -----------------------------------------------------------------------
  // Relations & graph view (P3)
  // -----------------------------------------------------------------------

  /** Relations on one page (as source or target) that this caller may see. */
  listRelations(nodeId: string) {
    return this.request<{ relations: RelationDto[] }>("GET", `/nodes/${nodeId}/relations`);
  }

  createRelation(sourceNodeId: string, input: CreateRelationInput) {
    return this.request<{ relation: RelationDto }>(
      "POST",
      `/nodes/${sourceNodeId}/relations`,
      input
    );
  }

  updateRelation(sourceNodeId: string, relationId: string, input: UpdateRelationInput) {
    return this.request<{ relation: RelationDto }>(
      "PATCH",
      `/nodes/${sourceNodeId}/relations/${relationId}`,
      input
    );
  }

  deleteRelation(sourceNodeId: string, relationId: string) {
    return this.request<{ ok: true }>(
      "DELETE",
      `/nodes/${sourceNodeId}/relations/${relationId}`
    );
  }

  /** The whole world's relation graph (visible nodes + edges). */
  graph(worldId: string) {
    return this.request<{ graph: Graph }>("GET", `/worlds/${worldId}/graph`);
  }

  /**
   * The Obsidian-style wikilink graph: every page the caller may read, joined
   * by the `[[links]]` between them. Undirected edges; a link to or from a
   * DM-only page never surfaces to a player.
   */
  wikiGraph(worldId: string) {
    return this.request<{ graph: WikiGraph }>("GET", `/worlds/${worldId}/wiki-graph`);
  }

  /** The neighborhood around one page — the page plus every link that touches it. */
  wikiNodeGraph(worldId: string, nodeId: string) {
    return this.request<{ graph: WikiGraph }>(
      "GET",
      `/worlds/${worldId}/nodes/${nodeId}/wiki-graph`,
    );
  }

  // -----------------------------------------------------------------------
  // Maps
  // -----------------------------------------------------------------------

  getMap(nodeId: string) {
    return this.request<{ map: MapDto }>("GET", `/nodes/${nodeId}/map`);
  }

  listMarkers(nodeId: string) {
    return this.request<{ markers: MapMarkerDto[] }>(
      "GET",
      `/nodes/${nodeId}/map/markers`
    );
  }

  createMarker(nodeId: string, input: CreateMarkerInput) {
    return this.request<{ marker: MapMarkerDto }>(
      "POST",
      `/nodes/${nodeId}/map/markers`,
      input
    );
  }

  updateMarker(markerId: string, input: UpdateMarkerInput) {
    return this.request<{ marker: MapMarkerDto }>(
      "PATCH",
      `/markers/${markerId}`,
      input
    );
  }

  deleteMarker(markerId: string) {
    return this.request<{ ok: true }>("DELETE", `/markers/${markerId}`);
  }

  // -----------------------------------------------------------------------
  // Map groups
  // -----------------------------------------------------------------------

  mapGroups(nodeId: string) {
    return this.request<{ groups: MapGroupDto[] }>(
      "GET",
      `/nodes/${nodeId}/map/groups`
    );
  }

  createMapGroup(nodeId: string, input: CreateMapGroupInput) {
    return this.request<{ group: MapGroupDto }>(
      "POST",
      `/nodes/${nodeId}/map/groups`,
      input
    );
  }

  updateMapGroup(groupId: string, input: UpdateMapGroupInput) {
    return this.request<{ group: MapGroupDto }>(
      "PATCH",
      `/map-groups/${groupId}`,
      input
    );
  }

  moveMapGroup(groupId: string, input: MoveMapGroupInput) {
    return this.request<{ ok: true }>(
      "POST",
      `/map-groups/${groupId}/move`,
      input
    );
  }

  deleteMapGroup(groupId: string) {
    return this.request<{ ok: true }>("DELETE", `/map-groups/${groupId}`);
  }

  // -----------------------------------------------------------------------
  // Templates
  // -----------------------------------------------------------------------

  listTemplates(worldId: string) {
    return this.request<{ templates: TemplateDto[] }>(
      "GET",
      `/worlds/${worldId}/templates`
    );
  }

  createTemplate(worldId: string, input: { name: string; nodeKind: string; fields?: Record<string, unknown> }) {
    return this.request<{ template: TemplateDto }>(
      "POST",
      `/worlds/${worldId}/templates`,
      input
    );
  }

  deleteTemplate(templateId: string) {
    return this.request<{ ok: true }>("DELETE", `/templates/${templateId}`);
  }

  // -----------------------------------------------------------------------
  // Share links
  // -----------------------------------------------------------------------

  listShareLinks(worldId: string) {
    return this.request<{ links: Array<{ id: string; nodeId: string; expiresAt: string | null; createdAt: string }> }>(
      "GET",
      `/worlds/${worldId}/share-links`
    );
  }

  createShareLink(worldId: string, nodeId: string, expiresInDays?: number) {
    return this.request<{ link: { id: string; url: string; nodeId: string; expiresAt: string | null } }>(
      "POST",
      `/worlds/${worldId}/share-links`,
      { nodeId, expiresInDays }
    );
  }

  revokeShareLink(linkId: string) {
    return this.request<{ ok: true }>("DELETE", `/share-links/${linkId}`);
  }

  // -----------------------------------------------------------------------
  // SSE / Realtime (future)
  // -----------------------------------------------------------------------

  /**
   * Subscribe to server-sent events for a world.
   * Returns an AbortController whose signal you pass to `fetch` so the
   * subscription can be cancelled.
   *
   * Event types (future): node_updated, marker_updated, hp_changed, etc.
   */
  subscribeToEvents(worldId: string): AbortController {
    const controller = new AbortController();
    const url = `${this.apiBaseUrl}/worlds/${worldId}/events?since=0`;

    fetch(url, {
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "text/event-stream",
      },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        console.error("[DndClient] SSE connection failed:", response.status);
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            // Dispatch to listeners registered via onEvent()
            this.dispatchEvent(event.type, event);
          } catch {
            // Non-JSON event — ignore
          }
        }
      }
    });

    return controller;
  }

  // -----------------------------------------------------------------------
  // Event dispatch (for SSE listeners)
  // -----------------------------------------------------------------------

  private listeners = new Map<string, Set<(event: unknown) => void>>();

  onEvent(type: string, handler: (event: unknown) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(handler);
    this.listeners.set(type, set);

    return () => {
      set.delete(handler);
    };
  }

  private dispatchEvent(type: string, event: unknown) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        // Don't let one handler break the stream
      }
    }
  }
}
