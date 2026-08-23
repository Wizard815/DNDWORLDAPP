import type {
  AclEntryDto,
  AddMemberInput,
  AssetDto,
  Backlink,
  ChangePasswordInput,
  CreateNodeInput,
  CreateTokenInput,
  CreatedShareLinkDto,
  CreatedTokenDto,
  GrantAclInput,
  LoginInput,
  MemberDto,
  MoveNodeInput,
  NodeDetail,
  NodeSummary,
  PostDto,
  SearchHit,
  SetupInput,
  ShareLinkDto,
  TokenDto,
  UpdateNodeInput,
  UserDto,
  Visibility,
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
  setupStatus: () => request<{ needsSetup: boolean }>("/setup/status"),

  setup: (input: SetupInput) =>
    request<{ user: UserDto; worldId: string }>("/setup", { method: "POST", ...json(input) }),

  login: (input: LoginInput) =>
    request<{ user: UserDto }>("/auth/login", { method: "POST", ...json(input) }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: UserDto }>("/auth/me"),

  changePassword: (input: ChangePasswordInput) =>
    request<{ ok: true }>("/auth/change-password", { method: "POST", ...json(input) }),

  worlds: () => request<{ worlds: WorldDto[] }>("/worlds"),

  tree: (worldId: string) => request<{ nodes: NodeSummary[] }>(`/worlds/${worldId}/tree`),

  search: (worldId: string, q: string) =>
    request<{ hits: SearchHit[] }>(`/worlds/${worldId}/search?q=${encodeURIComponent(q)}`),

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
  MemberDto,
  NodeDetail,
  NodeSummary,
  PostDto,
  SearchHit,
  ShareLinkDto,
  TokenDto,
  UserDto,
  WorldDto,
};
