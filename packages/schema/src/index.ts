import { z } from "zod";

/**
 * Shared contract between server, web client and the MCP server.
 *
 * Everything is a Zod schema first; the TypeScript types are inferred from it.
 * That way the OpenAPI document, the server's validation, the client's types and
 * the MCP tool signatures all come from one definition and cannot drift apart.
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
 * the way LegendKeeper attaches a type to each document on a page.
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

export const userDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  isServerAdmin: z.boolean(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

// ---------------------------------------------------------------------------
// Worlds
// ---------------------------------------------------------------------------

export const createWorldInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateWorldInput = z.infer<typeof createWorldInputSchema>;

export const worldDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: roleSchema,
  rootNodeId: z.string().nullable(),
});
export type WorldDto = z.infer<typeof worldDtoSchema>;

export const addMemberInputSchema = z.object({
  email: z.string().trim().email().max(254),
  role: roleSchema,
});
export type AddMemberInput = z.infer<typeof addMemberInputSchema>;

export const memberDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
});
export type MemberDto = z.infer<typeof memberDtoSchema>;

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

export const nodeSummarySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  kind: nodeKindSchema,
  visibility: visibilitySchema,
  sortKey: z.string(),
  childCount: z.number().int(),
  isArchived: z.boolean(),
  updatedAt: z.number().int(),
});
export type NodeSummary = z.infer<typeof nodeSummarySchema>;

export const backlinkSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  label: z.string().nullable(),
});
export type Backlink = z.infer<typeof backlinkSchema>;

export const breadcrumbEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
});

export const nodeDetailSchema = nodeSummarySchema.extend({
  worldId: z.string(),
  bodyMd: z.string(),
  templateId: z.string().nullable(),
  breadcrumb: z.array(breadcrumbEntrySchema),
  children: z.array(nodeSummarySchema),
  backlinks: z.array(backlinkSchema),
  canEdit: z.boolean(),
});
export type NodeDetail = z.infer<typeof nodeDetailSchema>;

export const unresolvedLinkSchema = z.object({
  targetText: z.string(),
  count: z.number().int(),
});
export type UnresolvedLink = z.infer<typeof unresolvedLinkSchema>;

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

export const postDtoSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  title: z.string(),
  bodyMd: z.string(),
  visibility: visibilitySchema,
  sortKey: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type PostDto = z.infer<typeof postDtoSchema>;

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchHitSchema = z.object({
  nodeId: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  snippet: z.string(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;

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

export const tokenDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  worldId: z.string().nullable(),
  scopes: z.array(scopeSchema),
  prefix: z.string(),
  createdAt: z.number().int(),
  lastUsedAt: z.number().int().nullable(),
  expiresAt: z.number().int().nullable(),
  revokedAt: z.number().int().nullable(),
});
export type TokenDto = z.infer<typeof tokenDtoSchema>;

/** Returned once, at creation. The plaintext is never stored or shown again. */
export const createdTokenDtoSchema = z.object({
  token: tokenDtoSchema,
  secret: z.string(),
});
export type CreatedTokenDto = z.infer<typeof createdTokenDtoSchema>;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const assetDtoSchema = z.object({
  id: z.string(),
  url: z.string(),
  mime: z.string(),
  bytes: z.number().int(),
  origName: z.string(),
});
export type AssetDto = z.infer<typeof assetDtoSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const okSchema = z.object({ ok: z.literal(true) });
