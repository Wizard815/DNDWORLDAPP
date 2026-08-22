import type {
  AssetDto,
  Backlink,
  CreateNodeInput,
  CreateTokenInput,
  CreatedTokenDto,
  MoveNodeInput,
  NodeDetail,
  NodeSummary,
  PostDto,
  SearchHit,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
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

  setup: (input: { name: string; email: string; password: string; worldName: string }) =>
    request<{ user: UserDto; worldId: string }>("/setup", { method: "POST", ...json(input) }),

  login: (input: { email: string; password: string }) =>
    request<{ user: UserDto }>("/auth/login", { method: "POST", ...json(input) }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: UserDto }>("/auth/me"),

  worlds: () => request<{ worlds: WorldDto[] }>("/worlds"),

  tree: (worldId: string) => request<{ nodes: NodeSummary[] }>(`/worlds/${worldId}/tree`),

  search: (worldId: string, q: string) =>
    request<{ hits: SearchHit[] }>(`/worlds/${worldId}/search?q=${encodeURIComponent(q)}`),

  unresolvedLinks: (worldId: string) =>
    request<{ links: Array<{ targetText: string; count: number }> }>(
      `/worlds/${worldId}/unresolved-links`,
    ),

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
    const response = await fetch(`/api/v1/worlds/${worldId}/assets`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    if (!response.ok) throw new ApiError(response.status, "upload_failed", "Upload failed.");
    return ((await response.json()) as { asset: AssetDto }).asset;
  },
};

export type { Backlink, NodeDetail, NodeSummary, PostDto, SearchHit, TokenDto, UserDto, WorldDto };
