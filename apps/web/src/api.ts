import type {
  ConnectionsDto,
  CreateRelationInput,
  RelationDto,
  RelationLabelDto,
  UpdateRelationInput,
  AclEntryDto,
  AddMemberInput,
  AssetDto,
  Backlink,
  ChangePasswordInput,
  CreateFieldInput,
  CreateMapGroupInput,
  CreateMarkerInput,
  CreateMarkerPresetInput,
  CreateNodeInput,
  CreateTemplateInput,
  CreateTokenInput,
  CreatedShareLinkDto,
  CreatedTokenDto,
  FieldDto,
  FieldType,
  FieldVisibility,
  GrantAclInput,
  IconHit,
  IconSet,
  LoginInput,
  MapDto,
  MapGroupDto,
  MapMarkerDto,
  MarkerPresetDto,
  MemberDto,
  MoveFieldInput,
  MoveMapGroupInput,
  MoveNodeInput,
  NodeDetail,
  NodeSummary,
  PostDto,
  SearchHit,
  SetupInput,
  ShareLinkDto,
  TemplateDto,
  TemplateFieldDef,
  TokenDto,
  UpdateFieldInput,
  UpdateMapGroupInput,
  UpdateMapInput,
  UpdateMarkerInput,
  UpdateNodeInput,
  UpdateTemplateInput,
  UserDto,
  Visibility,
  RemovedNode,
  CreateTagInput,
  NodeTag,
  TagDto,
  UpdateTagInput,
  WorldDto,
} from "@dndworldapp/schema";

/**
 * Every call the client makes goes through the public API. There is no private
 * back door — which is what keeps the API complete enough for the MCP server.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * "View as a player": an owner/DM previewing their own world exactly as a
 * player would see it. A module-level flag rather than a parameter threaded
 * through every call site — every request picks it up automatically, and
 * turning it on/off is one call from App.tsx followed by a query invalidation.
 */
let viewAsPlayer = false;
export function setViewAsPlayer(enabled: boolean): void {
  viewAsPlayer = enabled;
}
export function isViewingAsPlayer(): boolean {
  return viewAsPlayer;
}

/**
 * `fetch()` itself throws (not a rejected HTTP response — the request never
 * reached a server at all: it's down, unreachable, or the connection was
 * refused) as a plain `TypeError`, which callers checking `err instanceof
 * ApiError` never catch, so every one of them fell through to a generic
 * "something went wrong" with no way to tell "your input was bad" apart from
 * "the server isn't there." Wrapping it here fixes that for every call site
 * at once, rather than needing every catch block to special-case it.
 */
async function fetchOrThrowApiError(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(0, "network_error", "Could not reach the server. Check that it's running, then try again.");
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchOrThrowApiError(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(viewAsPlayer ? { "x-view-as": "player" } : {}),
      ...init?.headers,
    },
    credentials: "same-origin",
  });

  if (!response.ok) {
    let code = "http_error";
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new ApiError(response.status, code, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  setupStatus: () => request<{ needsSetup: boolean; guestLogin: boolean }>("/setup/status"),

  setup: (input: SetupInput) =>
    request<{ user: UserDto; worldId: string }>("/setup", { method: "POST", ...json(input) }),

  login: (input: LoginInput) =>
    request<{ user: UserDto }>("/auth/login", { method: "POST", ...json(input) }),

  guestLogin: () => request<{ user: UserDto }>("/auth/guest", { method: "POST" }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: UserDto }>("/auth/me"),

  changePassword: (input: ChangePasswordInput) =>
    request<{ ok: true }>("/auth/change-password", { method: "POST", ...json(input) }),

  worlds: () => request<{ worlds: WorldDto[] }>("/worlds"),

  tree: (worldId: string) => request<{ nodes: NodeSummary[] }>(`/worlds/${worldId}/tree`),

  search: (worldId: string, q: string) =>
    request<{ hits: SearchHit[] }>(`/worlds/${worldId}/search?q=${encodeURIComponent(q)}`),

  connections: (nodeId: string) => request<{ connections: ConnectionsDto }>(`/nodes/${nodeId}/connections`),

  createRelation: (nodeId: string, input: CreateRelationInput) =>
    request<{ relation: RelationDto }>(`/nodes/${nodeId}/relations`, { method: "POST", ...json(input) }),

  updateRelation: (relationId: string, input: UpdateRelationInput) =>
    request<{ relation: RelationDto }>(`/relations/${relationId}`, { method: "PATCH", ...json(input) }),

  deleteRelation: (relationId: string) => request<{ ok: true }>(`/relations/${relationId}`, { method: "DELETE" }),

  relationLabels: (worldId: string) =>
    request<{ labels: RelationLabelDto[] }>(`/worlds/${worldId}/relation-labels`),

  unresolvedLinks: (worldId: string) =>
    request<{ links: Array<{ targetText: string; count: number }> }>(
      `/worlds/${worldId}/unresolved-links`,
    ),

  members: (worldId: string) => request<{ members: MemberDto[] }>(`/worlds/${worldId}/members`),

  addMember: (worldId: string, input: AddMemberInput) =>
    request<{ member: MemberDto }>(`/worlds/${worldId}/members`, { method: "POST", ...json(input) }),

  removeMember: (worldId: string, userId: string) =>
    request<{ ok: true }>(`/worlds/${worldId}/members/${userId}`, { method: "DELETE" }),

  resetMemberPassword: (worldId: string, userId: string, newPassword: string) =>
    request<{ ok: true }>(`/worlds/${worldId}/members/${userId}/reset-password`, {
      method: "POST",
      ...json({ newPassword }),
    }),

  createNode: (worldId: string, input: CreateNodeInput) =>
    request<{ node: { id: string; title: string; parentId: string | null } }>(
      `/worlds/${worldId}/nodes`,
      { method: "POST", ...json(input) },
    ),

  node: (nodeId: string) => request<{ node: NodeDetail }>(`/nodes/${nodeId}`),

  updateNode: (nodeId: string, input: UpdateNodeInput) =>
    request<{ node: NodeDetail }>(`/nodes/${nodeId}`, { method: "PATCH", ...json(input) }),

  moveNode: (nodeId: string, input: MoveNodeInput) =>
    request<{ node: { id: string } }>(`/nodes/${nodeId}/move`, { method: "POST", ...json(input) }),

  archiveNode: (nodeId: string) => request<{ ok: true }>(`/nodes/${nodeId}`, { method: "DELETE" }),
  trashNode: (nodeId: string) => request<{ ok: true }>(`/nodes/${nodeId}/trash`, { method: "POST" }),
  restoreNode: (nodeId: string) => request<{ ok: true }>(`/nodes/${nodeId}/restore`, { method: "POST" }),
  deleteNodeForever: (nodeId: string) => request<{ ok: true }>(`/nodes/${nodeId}/forever`, { method: "DELETE" }),
  tags: (worldId: string) => request<{ tags: TagDto[] }>(`/worlds/${worldId}/tags`),
  createTag: (worldId: string, input: CreateTagInput) =>
    request<{ tag: TagDto }>(`/worlds/${worldId}/tags`, { method: "POST", ...json(input) }),
  updateTag: (tagId: string, input: UpdateTagInput) =>
    request<{ tag: TagDto }>(`/tags/${tagId}`, { method: "PATCH", ...json(input) }),
  deleteTag: (tagId: string) => request<{ ok: true }>(`/tags/${tagId}`, { method: "DELETE" }),
  mergeTag: (tagId: string, intoTagId: string) =>
    request<{ tag: TagDto }>(`/tags/${tagId}/merge`, { method: "POST", ...json({ intoTagId }) }),
  tagPages: (tagId: string, children = true) =>
    request<{ nodes: NodeSummary[] }>(`/tags/${tagId}/pages?children=${children ? "1" : "0"}`),
  setNodeTags: (nodeId: string, tags: string[]) =>
    request<{ tags: NodeTag[] }>(`/nodes/${nodeId}/tags`, { method: "PUT", ...json({ tags }) }),
  removedNodes: (worldId: string) =>
    request<{ archived: RemovedNode[]; trashed: RemovedNode[] }>(`/worlds/${worldId}/removed`),

  acl: (nodeId: string) => request<{ entries: AclEntryDto[] }>(`/nodes/${nodeId}/acl`),

  grantAcl: (nodeId: string, input: GrantAclInput) =>
    request<{ entry: AclEntryDto }>(`/nodes/${nodeId}/acl`, { method: "POST", ...json(input) }),

  revokeAcl: (nodeId: string, aclId: string) =>
    request<{ ok: true }>(`/nodes/${nodeId}/acl/${aclId}`, { method: "DELETE" }),

  shareLinks: (nodeId: string) => request<{ shareLinks: ShareLinkDto[] }>(`/nodes/${nodeId}/share-links`),

  createShareLink: (nodeId: string) =>
    request<CreatedShareLinkDto>(`/nodes/${nodeId}/share-links`, { method: "POST" }),

  revokeShareLink: (nodeId: string, shareLinkId: string) =>
    request<{ ok: true }>(`/nodes/${nodeId}/share-links/${shareLinkId}`, { method: "DELETE" }),

  /** The anonymous half of a share link — no cookie or token needed. */
  sharedTree: (token: string) =>
    request<{ rootId: string; nodes: NodeSummary[] }>(`/share/${token}/tree`),

  sharedNode: (token: string, nodeId: string) =>
    request<{ node: NodeDetail }>(`/share/${token}/nodes/${nodeId}`),

  posts: (nodeId: string) => request<{ posts: PostDto[] }>(`/nodes/${nodeId}/posts`),

  createPost: (nodeId: string, input: { title: string; bodyMd: string; visibility: Visibility }) =>
    request<{ post: PostDto }>(`/nodes/${nodeId}/posts`, { method: "POST", ...json(input) }),

  updatePost: (
    postId: string,
    input: { title?: string; bodyMd?: string; visibility?: Visibility },
  ) => request<{ post: PostDto }>(`/posts/${postId}`, { method: "PATCH", ...json(input) }),

  deletePost: (postId: string) => request<{ ok: true }>(`/posts/${postId}`, { method: "DELETE" }),

  tokens: () => request<{ tokens: TokenDto[] }>("/tokens"),

  createToken: (input: CreateTokenInput) =>
    request<CreatedTokenDto>("/tokens", { method: "POST", ...json(input) }),

  revokeToken: (tokenId: string) =>
    request<{ ok: true }>(`/tokens/${tokenId}`, { method: "DELETE" }),

  templates: (worldId: string) => request<{ templates: TemplateDto[] }>(`/worlds/${worldId}/templates`),

  createTemplate: (worldId: string, input: CreateTemplateInput) =>
    request<{ template: TemplateDto }>(`/worlds/${worldId}/templates`, { method: "POST", ...json(input) }),

  updateTemplate: (worldId: string, templateId: string, input: UpdateTemplateInput) =>
    request<{ template: TemplateDto }>(`/worlds/${worldId}/templates/${templateId}`, {
      method: "PATCH",
      ...json(input),
    }),

  deleteTemplate: (worldId: string, templateId: string) =>
    request<{ ok: true }>(`/worlds/${worldId}/templates/${templateId}`, { method: "DELETE" }),

  fields: (nodeId: string) => request<{ fields: FieldDto[] }>(`/nodes/${nodeId}/fields`),

  createField: (nodeId: string, input: CreateFieldInput) =>
    request<{ field: FieldDto }>(`/nodes/${nodeId}/fields`, { method: "POST", ...json(input) }),

  updateField: (nodeId: string, fieldId: string, input: UpdateFieldInput) =>
    request<{ field: FieldDto }>(`/nodes/${nodeId}/fields/${fieldId}`, { method: "PATCH", ...json(input) }),

  deleteField: (nodeId: string, fieldId: string) =>
    request<{ ok: true }>(`/nodes/${nodeId}/fields/${fieldId}`, { method: "DELETE" }),

  moveField: (nodeId: string, fieldId: string, input: MoveFieldInput) =>
    request<{ ok: true }>(`/nodes/${nodeId}/fields/${fieldId}/move`, { method: "POST", ...json(input) }),

  applyTemplate: (nodeId: string) =>
    request<{ fields: FieldDto[] }>(`/nodes/${nodeId}/apply-template`, { method: "POST" }),

  map: (nodeId: string) => request<{ map: MapDto }>(`/nodes/${nodeId}/map`),

  putFogMask: (nodeId: string, png: string) =>
    request<{ map: MapDto }>(`/nodes/${nodeId}/map/fog`, { method: "PUT", ...json({ png }) }),

  updateMap: (nodeId: string, input: UpdateMapInput) =>
    request<{ map: MapDto }>(`/nodes/${nodeId}/map`, { method: "PATCH", ...json(input) }),

  setMapImage: (nodeId: string, assetId: string, fog?: "keep" | "reset") =>
    request<{ map: MapDto }>(`/nodes/${nodeId}/map`, { method: "PUT", ...json({ assetId, fog }) }),

  mapMarkers: (nodeId: string) => request<{ markers: MapMarkerDto[] }>(`/nodes/${nodeId}/map/markers`),

  createMarker: (nodeId: string, input: CreateMarkerInput) =>
    request<{ marker: MapMarkerDto }>(`/nodes/${nodeId}/map/markers`, { method: "POST", ...json(input) }),

  updateMarker: (markerId: string, input: UpdateMarkerInput) =>
    request<{ marker: MapMarkerDto }>(`/markers/${markerId}`, { method: "PATCH", ...json(input) }),

  deleteMarker: (markerId: string) => request<{ ok: true }>(`/markers/${markerId}`, { method: "DELETE" }),

  mapGroups: (nodeId: string) => request<{ groups: MapGroupDto[] }>(`/nodes/${nodeId}/map/groups`),

  createMapGroup: (nodeId: string, input: CreateMapGroupInput) =>
    request<{ group: MapGroupDto }>(`/nodes/${nodeId}/map/groups`, { method: "POST", ...json(input) }),

  updateMapGroup: (groupId: string, input: UpdateMapGroupInput) =>
    request<{ group: MapGroupDto }>(`/map-groups/${groupId}`, { method: "PATCH", ...json(input) }),

  moveMapGroup: (groupId: string, input: MoveMapGroupInput) =>
    request<{ ok: true }>(`/map-groups/${groupId}/move`, { method: "POST", ...json(input) }),

  deleteMapGroup: (groupId: string) => request<{ ok: true }>(`/map-groups/${groupId}`, { method: "DELETE" }),

  markerPresets: (worldId: string) =>
    request<{ presets: MarkerPresetDto[] }>(`/worlds/${worldId}/marker-presets`),

  createMarkerPreset: (worldId: string, input: CreateMarkerPresetInput) =>
    request<{ preset: MarkerPresetDto }>(`/worlds/${worldId}/marker-presets`, { method: "POST", ...json(input) }),

  deleteMarkerPreset: (worldId: string, presetId: string) =>
    request<{ ok: true }>(`/worlds/${worldId}/marker-presets/${presetId}`, { method: "DELETE" }),

  searchIcons: (q: string, set?: IconSet, limit = 120) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (set !== undefined) params.set("set", set);
    return request<{ icons: IconHit[]; total: number }>(`/icons?${params.toString()}`);
  },

  uploadAsset: async (worldId: string, file: File): Promise<AssetDto> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetchOrThrowApiError(`/api/v1/worlds/${worldId}/assets`, {
      method: "POST",
      body: form,
      headers: viewAsPlayer ? { "x-view-as": "player" } : undefined,
      credentials: "same-origin",
    });
    if (!response.ok) throw new ApiError(response.status, "upload_failed", "Upload failed.");
    return ((await response.json()) as { asset: AssetDto }).asset;
  },
};

export type {
  AclEntryDto,
  Backlink,
  FieldDto,
  FieldType,
  FieldVisibility,
  MapDto,
  MapMarkerDto,
  MarkerPresetDto,
  MemberDto,
  NodeDetail,
  NodeSummary,
  PostDto,
  SearchHit,
  ShareLinkDto,
  TemplateDto,
  TemplateFieldDef,
  TokenDto,
  UserDto,
  WorldDto,
};
