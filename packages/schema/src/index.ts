import { z } from "zod";

/**
 * Shared contract between server, web client and (from P1) the MCP server.
 * The server validates with these; the client infers its types from them.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Who may see a thing. Ordered least- to most-restricted.
 * `public`  guests on a share link, and anyone if the world is published
 * `members` any logged-in member of the world (players included)
 * `dm`      owner + dm roles only
 * `private` the creator only
 */
export const VISIBILITIES = ["public", "members", "dm", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const visibilitySchema = z.enum(VISIBILITIES);

export const ROLES = ["owner", "dm", "player", "guest"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

/**
 * What renderer a node uses. The node table is one table; `kind` picks the view,
 * the way LegendKeeper swaps `resource-viewer ... map` for `... timeline`.
 * P0 only implements `document`; the rest are reserved so their data can land
 * without a migration.
 */
export const NODE_KINDS = [
  "document",
  "map",
  "timeline",
  "calendar",
  "board",
  "view",
  "tag",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export const nodeKindSchema = z.enum(NODE_KINDS);

// ---------------------------------------------------------------------------
// Auth + setup
// ---------------------------------------------------------------------------

export const setupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(512),
  worldName: z.string().trim().min(1).max(120),
});
export type SetupInput = z.infer<typeof setupInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(512),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export interface UserDto {
  id: string;
  name: string;
  email: string;
  isServerAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

export const createWorldInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateWorldInput = z.infer<typeof createWorldInputSchema>;

export interface WorldDto {
  id: string;
  name: string;
  slug: string;
  role: Role;
  rootNodeId: string | null;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export const createNodeInputSchema = z.object({
  title: z.string().trim().min(1).max(300).default("Untitled"),
  parentId: z.string().nullable().optional(),
  kind: nodeKindSchema.optional(),
  templateId: z.string().nullable().optional(),
  /** A single emoji. Rendered verbatim by the client. */
  icon: z.string().max(60).nullable().optional(),
  visibility: visibilitySchema.optional(),
  bodyMd: z.string().max(2_000_000).optional(),
});
export type CreateNodeInput = z.infer<typeof createNodeInputSchema>;

export const updateNodeInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    bodyMd: z.string().max(2_000_000),
    icon: z.string().max(60).nullable(),
    visibility: visibilitySchema,
    templateId: z.string().nullable(),
    isArchived: z.boolean(),
  })
  .partial();
export type UpdateNodeInput = z.infer<typeof updateNodeInputSchema>;

/**
 * Move is expressed as "put me under `parentId`, between these two siblings".
 * The server derives a fractional sort key, so no sibling rows are rewritten.
 */
export const moveNodeInputSchema = z.object({
  parentId: z.string().nullable(),
  afterId: z.string().nullable().optional(),
  beforeId: z.string().nullable().optional(),
});
export type MoveNodeInput = z.infer<typeof moveNodeInputSchema>;

export interface NodeSummary {
  id: string;
  parentId: string | null;
  title: string;
  slug: string;
  icon: string | null;
  kind: NodeKind;
  visibility: Visibility;
  sortKey: string;
  childCount: number;
  isArchived: boolean;
  updatedAt: number;
}

export interface NodeDetail extends NodeSummary {
  worldId: string;
  bodyMd: string;
  templateId: string | null;
  breadcrumb: Array<{ id: string; title: string; icon: string | null }>;
  children: NodeSummary[];
  backlinks: Backlink[];
  canEdit: boolean;
}

export interface Backlink {
  nodeId: string;
  title: string;
  icon: string | null;
  label: string | null;
}

export interface UnresolvedLink {
  targetText: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Posts (Kanka's entity notes: a node's DM-only sections live here)
// ---------------------------------------------------------------------------

export const createPostInputSchema = z.object({
  title: z.string().trim().max(300).default(""),
  bodyMd: z.string().max(2_000_000).default(""),
  visibility: visibilitySchema.default("members"),
});
export type CreatePostInput = z.infer<typeof createPostInputSchema>;

export const updatePostInputSchema = createPostInputSchema.partial();
export type UpdatePostInput = z.infer<typeof updatePostInputSchema>;

export interface PostDto {
  id: string;
  nodeId: string;
  title: string;
  bodyMd: string;
  visibility: Visibility;
  sortKey: string;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export interface SearchHit {
  nodeId: string;
  title: string;
  icon: string | null;
  snippet: string;
}

// ---------------------------------------------------------------------------
// API tokens
// ---------------------------------------------------------------------------

/**
 * Scopes only narrow what the token's owner can already do — they never grant.
 * `world:read`   GET requests
 * `world:write`  everything that changes data
 * `admin`        accounts and membership management
 */
export const SCOPES = ["world:read", "world:write", "admin"] as const;
export type Scope = (typeof SCOPES)[number];
export const scopeSchema = z.enum(SCOPES);

export const createTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Pin the token to one world. Omit for every world the owner belongs to. */
  worldId: z.string().nullable().optional(),
  scopes: z.array(scopeSchema).min(1).default(["world:read"]),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});
export type CreateTokenInput = z.infer<typeof createTokenInputSchema>;

export interface TokenDto {
  id: string;
  name: string;
  worldId: string | null;
  scopes: Scope[];
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

/** Returned once, at creation. The plaintext is never stored or shown again. */
export interface CreatedTokenDto {
  token: TokenDto;
  secret: string;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface AssetDto {
  id: string;
  url: string;
  mime: string;
  bytes: number;
  origName: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
