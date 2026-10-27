import type {
  CreateRelationInput,
  RelationDto,
  RelationLabelDto,
  UpdateRelationInput,
  CreateFieldInput,
  CreateMapGroupInput,
  CreateMarkerInput,
  CreateMarkerPresetInput,
  CreateNodeInput,
  CreatePostInput,
  FieldDto,
  IconHit,
  MapDto,
  MapGroupDto,
  MapMarkerDto,
  MarkerPresetDto,
  MoveMapGroupInput,
  MoveNodeInput,
  NodeDetail,
  NodeSummary,
  PostDto,
  RemovedNode,
  SearchHit,
  TagDto,
  NodeTag,
  TemplateDto,
  UnresolvedLink,
  UpdateFieldInput,
  UpdateMapGroupInput,
  UpdateMapInput,
  UpdateMarkerInput,
  UpdateMarkerPresetInput,
  UpdateNodeInput,
  UpdatePostInput,
  WorldDto,
} from "@dndworldapp/schema";

/**
 * The MCP server talks to DNDWORLDAPP over its public HTTP API — never to the
 * database. That is deliberate: it keeps the API the single contract, so anything
 * the MCP server can do, a script or the web client can do too.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export interface ClientConfig {
  baseUrl: string;
  token: string;
  /** When set, tools default to this world and `list_worlds` is mostly moot. */
  worldId: string | null;
}

export class WorldClient {
  private readonly baseUrl: string;
  private readonly token: string;
  readonly pinnedWorldId: string | null;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.pinnedWorldId = config.worldId;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/v1${path}`, {
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
        const parsed = (await response.json()) as { error?: { code?: string; message?: string } };
        code = parsed.error?.code ?? code;
        message = parsed.error?.message ?? message;
      } catch {
        // Non-JSON error body; the status line will have to do.
      }
      throw new ApiError(response.status, code, message);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** The world to act on: the caller's choice, the pinned one, or the only one. */
  async resolveWorldId(explicit?: string | null): Promise<string> {
    if (explicit !== undefined && explicit !== null && explicit.length > 0) return explicit;
    if (this.pinnedWorldId !== null) return this.pinnedWorldId;

    const { worlds } = await this.listWorlds();
    if (worlds.length === 0) throw new ApiError(404, "no_world", "This token can reach no worlds.");
    if (worlds.length > 1) {
      const names = worlds.map((w) => `${w.name} (${w.id})`).join(", ");
      throw new ApiError(
        400,
        "ambiguous_world",
        `This token can reach several worlds, so pass world_id explicitly. Available: ${names}`,
      );
    }
    return worlds[0]!.id;
  }

  listWorlds() {
    return this.request<{ worlds: WorldDto[] }>("GET", "/worlds");
  }

  tree(worldId: string) {
    return this.request<{ nodes: NodeSummary[] }>("GET", `/worlds/${worldId}/tree`);
  }

  search(worldId: string, q: string, limit = 25) {
    const query = `q=${encodeURIComponent(q)}&limit=${limit}`;
    return this.request<{ hits: SearchHit[] }>("GET", `/worlds/${worldId}/search?${query}`);
  }

  markerPresets(worldId: string) {
    return this.request<{ presets: MarkerPresetDto[] }>("GET", `/worlds/${worldId}/marker-presets`);
  }

  searchIcons(q: string, set?: string, limit = 40) {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (set !== undefined) params.set("set", set);
    return this.request<{ icons: IconHit[]; total: number }>("GET", `/icons?${params.toString()}`);
  }

  unresolvedLinks(worldId: string) {
    return this.request<{ links: UnresolvedLink[] }>("GET", `/worlds/${worldId}/unresolved-links`);
  }

  node(nodeId: string) {
    return this.request<{ node: NodeDetail }>("GET", `/nodes/${nodeId}`);
  }

  relations(nodeId: string) {
    return this.request<{ relations: RelationDto[] }>("GET", `/nodes/${nodeId}/relations`);
  }

  createRelation(nodeId: string, input: CreateRelationInput) {
    return this.request<{ relation: RelationDto }>("POST", `/nodes/${nodeId}/relations`, input);
  }

  updateRelation(relationId: string, input: UpdateRelationInput) {
    return this.request<{ relation: RelationDto }>("PATCH", `/relations/${relationId}`, input);
  }

  deleteRelation(relationId: string) {
    return this.request<{ ok: true }>("DELETE", `/relations/${relationId}`);
  }

  relationLabels(worldId: string) {
    return this.request<{ labels: RelationLabelDto[] }>("GET", `/worlds/${worldId}/relation-labels`);
  }

  createNode(worldId: string, input: CreateNodeInput) {
    return this.request<{ node: { id: string; title: string; parentId: string | null } }>(
      "POST",
      `/worlds/${worldId}/nodes`,
      input,
    );
  }

  updateNode(nodeId: string, input: UpdateNodeInput) {
    return this.request<{ node: NodeDetail }>("PATCH", `/nodes/${nodeId}`, input);
  }

  moveNode(nodeId: string, input: MoveNodeInput) {
    return this.request<{ node: { id: string; parentId: string | null; sortKey: string } }>(
      "POST",
      `/nodes/${nodeId}/move`,
      input,
    );
  }

  archiveNode(nodeId: string) {
    return this.request<{ ok: true }>("DELETE", `/nodes/${nodeId}`);
  }

  trashNode(nodeId: string) {
    return this.request<{ ok: true }>("POST", `/nodes/${nodeId}/trash`);
  }

  restoreNode(nodeId: string) {
    return this.request<{ ok: true }>("POST", `/nodes/${nodeId}/restore`);
  }

  tags(worldId: string) {
    return this.request<{ tags: TagDto[] }>("GET", `/worlds/${worldId}/tags`);
  }

  tagPages(tagId: string, children = true) {
    return this.request<{ nodes: NodeSummary[] }>("GET", `/tags/${tagId}/pages?children=${children ? "1" : "0"}`);
  }

  setNodeTags(nodeId: string, tags: string[]) {
    return this.request<{ tags: NodeTag[] }>("PUT", `/nodes/${nodeId}/tags`, { tags });
  }

  removedNodes(worldId: string) {
    return this.request<{ archived: RemovedNode[]; trashed: RemovedNode[] }>("GET", `/worlds/${worldId}/removed`);
  }

  createMarkerPreset(worldId: string, input: CreateMarkerPresetInput) {
    return this.request<{ preset: MarkerPresetDto }>("POST", `/worlds/${worldId}/marker-presets`, input);
  }

  updateMarkerPreset(worldId: string, presetId: string, input: UpdateMarkerPresetInput) {
    return this.request<{ preset: MarkerPresetDto }>("PATCH", `/worlds/${worldId}/marker-presets/${presetId}`, input);
  }

  deleteMarkerPreset(worldId: string, presetId: string) {
    return this.request<{ ok: true }>("DELETE", `/worlds/${worldId}/marker-presets/${presetId}`);
  }

  posts(nodeId: string) {
    return this.request<{ posts: PostDto[] }>("GET", `/nodes/${nodeId}/posts`);
  }

  createPost(nodeId: string, input: CreatePostInput) {
    return this.request<{ post: PostDto }>("POST", `/nodes/${nodeId}/posts`, input);
  }

  updatePost(postId: string, input: UpdatePostInput) {
    return this.request<{ post: PostDto }>("PATCH", `/posts/${postId}`, input);
  }

  templates(worldId: string) {
    return this.request<{ templates: TemplateDto[] }>("GET", `/worlds/${worldId}/templates`);
  }

  fields(nodeId: string) {
    return this.request<{ fields: FieldDto[] }>("GET", `/nodes/${nodeId}/fields`);
  }

  createField(nodeId: string, input: CreateFieldInput) {
    return this.request<{ field: FieldDto }>("POST", `/nodes/${nodeId}/fields`, input);
  }

  updateField(nodeId: string, fieldId: string, input: UpdateFieldInput) {
    return this.request<{ field: FieldDto }>("PATCH", `/nodes/${nodeId}/fields/${fieldId}`, input);
  }

  deleteField(nodeId: string, fieldId: string) {
    return this.request<{ ok: true }>("DELETE", `/nodes/${nodeId}/fields/${fieldId}`);
  }

  applyTemplate(nodeId: string) {
    return this.request<{ fields: FieldDto[] }>("POST", `/nodes/${nodeId}/apply-template`);
  }

  map(nodeId: string) {
    return this.request<{ map: MapDto }>("GET", `/nodes/${nodeId}/map`);
  }

  updateMap(nodeId: string, input: UpdateMapInput) {
    return this.request<{ map: MapDto }>("PATCH", `/nodes/${nodeId}/map`, input);
  }

  mapMarkers(nodeId: string) {
    return this.request<{ markers: MapMarkerDto[] }>("GET", `/nodes/${nodeId}/map/markers`);
  }

  createMarker(nodeId: string, input: CreateMarkerInput) {
    return this.request<{ marker: MapMarkerDto }>("POST", `/nodes/${nodeId}/map/markers`, input);
  }

  updateMarker(markerId: string, input: UpdateMarkerInput) {
    return this.request<{ marker: MapMarkerDto }>("PATCH", `/markers/${markerId}`, input);
  }

  deleteMarker(markerId: string) {
    return this.request<{ ok: true }>("DELETE", `/markers/${markerId}`);
  }

  mapGroups(nodeId: string) {
    return this.request<{ groups: MapGroupDto[] }>("GET", `/nodes/${nodeId}/map/groups`);
  }

  createMapGroup(nodeId: string, input: CreateMapGroupInput) {
    return this.request<{ group: MapGroupDto }>("POST", `/nodes/${nodeId}/map/groups`, input);
  }

  updateMapGroup(groupId: string, input: UpdateMapGroupInput) {
    return this.request<{ group: MapGroupDto }>("PATCH", `/map-groups/${groupId}`, input);
  }

  moveMapGroup(groupId: string, input: MoveMapGroupInput) {
    return this.request<{ ok: true }>("POST", `/map-groups/${groupId}/move`, input);
  }

  deleteMapGroup(groupId: string) {
    return this.request<{ ok: true }>("DELETE", `/map-groups/${groupId}`);
  }
}
