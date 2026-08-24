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

/**
 * The login identifier. This app is self-hosted with no SMTP, ever — there is no
 * verification email, no password-reset email, so there was never a reason for
 * this to look like an address. Accounts are created by a human (the owner at
 * first-run, a DM for everyone after), never by self-service signup.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, underscore, period and hyphen only.");

/** Shared by every "set this account's password" field. */
export const passwordSchema = z.string().min(10).max(512);

export const setupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  username: usernameSchema,
  password: passwordSchema,
  worldName: z.string().trim().min(1).max(120),
});
export type SetupInput = z.infer<typeof setupInputSchema>;

export const loginInputSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(512),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export const userDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
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

/**
 * Adds someone to a world. If `username` already belongs to an account, they are
 * simply added with `role` and `name`/`password` are ignored — this is the
 * "existing account" path. If it does not, `name` and `password` become
 * required and a brand-new account is created in the same step: the DM's admin
 * panel, not an email invite.
 */
export const addMemberInputSchema = z.object({
  username: usernameSchema,
  role: roleSchema,
  name: z.string().trim().min(1).max(120).optional(),
  password: passwordSchema.optional(),
});
export type AddMemberInput = z.infer<typeof addMemberInputSchema>;

export const resetPasswordInputSchema = z.object({
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

export const memberDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
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
// Templates and typed fields (P3) — a Template is a world-scoped, named,
// ordered list of field DEFINITIONS; assigning one to a node instantiates
// per-node field VALUES the DM can then edit freely, including diverging
// from the template (add extra ad hoc fields, skip some). Editing a
// template's field_schema later never retroactively touches nodes that
// already instantiated fields from it — see services/templates.ts.
// ---------------------------------------------------------------------------

export const FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "checkbox",
  "select",
  "date",
  "link",
  "section",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const fieldTypeSchema = z.enum(FIELD_TYPES);

/** Fields have no creator column, so there is no meaningful 'private' level here. */
export const FIELD_VISIBILITIES = ["public", "members", "dm"] as const;
export type FieldVisibility = (typeof FIELD_VISIBILITIES)[number];
export const fieldVisibilitySchema = z.enum(FIELD_VISIBILITIES);

/**
 * One field definition inside a template's field_schema array. `key` is the
 * label the DM actually types and sees — free text, not a machine slug
 * (matches Kanka's attribute "name"). Array order is field order; there is
 * no separate sort key at the template level.
 */
export const templateFieldDefSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    type: fieldTypeSchema,
    label: z.string().trim().min(1).max(120),
    options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    defaultValue: z.union([z.string(), z.number(), z.boolean()]).nullable().optional(),
    visibility: fieldVisibilitySchema.default("members"),
  })
  .refine((f) => f.type !== "select" || (f.options?.length ?? 0) > 0, {
    message: "A select field needs at least one option.",
    path: ["options"],
  });
export type TemplateFieldDef = z.infer<typeof templateFieldDefSchema>;

const fieldSchemaArray = z
  .array(templateFieldDefSchema)
  .max(200)
  .refine((defs) => new Set(defs.map((d) => d.key)).size === defs.length, {
    message: "Field keys must be unique within a template.",
  });

export const createTemplateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  icon: z.string().max(60).nullable().optional(),
  fieldSchema: fieldSchemaArray.default([]),
  defaultBodyMd: z.string().max(2_000_000).default(""),
});
export type CreateTemplateInput = z.infer<typeof createTemplateInputSchema>;

export const updateTemplateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    icon: z.string().max(60).nullable(),
    fieldSchema: fieldSchemaArray,
    defaultBodyMd: z.string().max(2_000_000),
  })
  .partial();
export type UpdateTemplateInput = z.infer<typeof updateTemplateInputSchema>;

export const templateDtoSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  fieldSchema: z.array(templateFieldDefSchema),
  defaultBodyMd: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type TemplateDto = z.infer<typeof templateDtoSchema>;

export const fieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A field VALUE on one node. `label`/`options` are resolved server-side by
 * matching `key` against the node's assigned template's field_schema (if
 * any) — the fields table itself has no label column, on purpose: editing a
 * template later must not retroactively rewrite values already on nodes.
 */
export const fieldDtoSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  key: z.string(),
  type: fieldTypeSchema,
  value: fieldValueSchema,
  /** Present only for type 'link': the referenced node, for display. */
  refNode: z.object({ id: z.string(), title: z.string(), icon: z.string().nullable() }).nullable().optional(),
  label: z.string(),
  options: z.array(z.string()).nullable(),
  visibility: fieldVisibilitySchema,
  sortKey: z.string(),
});
export type FieldDto = z.infer<typeof fieldDtoSchema>;

/** Ad hoc field creation — only through a template can a field be type 'select'. */
export const createFieldInputSchema = z.object({
  key: z.string().trim().min(1).max(120),
  type: fieldTypeSchema.exclude(["select"]),
  value: fieldValueSchema.optional(),
  visibility: fieldVisibilitySchema.default("members"),
});
export type CreateFieldInput = z.infer<typeof createFieldInputSchema>;

/** key/type are immutable after creation — only the value and visibility change. */
export const updateFieldInputSchema = z
  .object({ value: fieldValueSchema, visibility: fieldVisibilitySchema })
  .partial();
export type UpdateFieldInput = z.infer<typeof updateFieldInputSchema>;

export const moveFieldInputSchema = z.object({
  afterId: z.string().nullable().optional(),
  beforeId: z.string().nullable().optional(),
});
export type MoveFieldInput = z.infer<typeof moveFieldInputSchema>;

// ---------------------------------------------------------------------------
// Maps (P4) — a map node has at most one `Map` (its source image + pixel bounds)
// and any number of `MapMarker`s. Markers are one typed table with a `shape`
// discriminator (pin/label/circle/polygon/path/token) rather than one table per
// shape, matching how `fields` covers every field type in one table. A marker
// linked to a node (`targetNodeId`) inherits that node's title/icon unless it sets
// its own override — resolved at read time in services/maps.ts, the same
// "don't duplicate, resolve from the source" pattern services/fields.ts already
// uses for template-seeded labels.
// ---------------------------------------------------------------------------

export const MARKER_SHAPES = ["pin", "label", "circle", "polygon", "path", "token"] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];
export const markerShapeSchema = z.enum(MARKER_SHAPES);

export const mapDtoSchema = z.object({
  nodeId: z.string(),
  assetUrl: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  minZoom: z.number().int(),
  maxZoom: z.number().int(),
  tilingStatus: z.enum(["none", "pending", "running", "ready", "error"]),
  fogEnabled: z.boolean(),
});
export type MapDto = z.infer<typeof mapDtoSchema>;

export const setMapImageInputSchema = z.object({ assetId: z.string() });
export type SetMapImageInput = z.infer<typeof setMapImageInputSchema>;

// ---------------------------------------------------------------------------
// Marker points (P4.3) — polygon/path vertices, stored as ONE string in the map's
// own pixel space: "x,y x,y ..." (Kanka's custom_shape format). The string is
// what round-trips through the DB/API/MCP; the parsed form (number pairs) is what
// the client renders and what the server validates. Both directions live here so
// the draw UI, the API validation, and the MCP server can never disagree on what
// a valid shape is.
//
// Well-formedness (parseable, finite, within the vertex cap) is enforced by the
// schema below and is reusable by the client + MCP. Shape-specific *semantics*
// (a polygon needs ≥ 3 vertices, a path ≥ 2, and only polygon/path carry points)
// are enforced in services/maps.ts, where input.shape is in scope, as 400s.
// ---------------------------------------------------------------------------

/** A single vertex in the map's pixel space, as [x, y]. */
export type MarkerPoint = [number, number];

/** Hard vertex cap. The 20k-char length cap already bounds this loosely; this is a tighter, shape-aware guard against a pathological points blob. */
export const MAX_MARKER_POINTS = 2_000;

// One coordinate: optional sign, integer or decimal, but no exponent/whitespace.
// ".5" and "5." are both rejected on purpose — the draw UI and any sane producer
// never emit them, so accepting them only widens the surface we have to reason about.
const COORD_RE = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Parse a stored/`points` string into vertices. Returns `null` when there is no
 * usable shape (absent, or empty/whitespace-only); returns `null` for anything that
 * is not well-formed, so callers can treat "null" uniformly as "no valid points".
 */
export function parseMarkerPoints(raw: string | null | undefined): MarkerPoint[] | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const out: MarkerPoint[] = [];
  for (const token of trimmed.split(/\s+/)) {
    const parts = token.split(",");
    if (parts.length !== 2) return null; // "1,2,3" is not one vertex
    if (!COORD_RE.test(parts[0]!) || !COORD_RE.test(parts[1]!)) return null;
    out.push([Number(parts[0]), Number(parts[1])]);
  }
  if (out.length === 0 || out.length > MAX_MARKER_POINTS) return null;
  return out;
}

/** True when `raw` parses into at least one well-formed vertex. */
export function isWellFormedPoints(raw: string): boolean {
  return (parseMarkerPoints(raw)?.length ?? 0) > 0;
}

/**
 * Serialize vertices back to the storage string. Rounds each coordinate to 2
 * decimal places — sub-pixel precision is meaningless for a hand-drawn region and
 * it keeps the string well under the length cap even for dense shapes. Full-
 * precision values from an API/MCP producer are stored verbatim by the server and
 * still parse fine; rounding is only a draw-UI compactness convenience.
 */
export function formatMarkerPoints(points: MarkerPoint[]): string {
  const round = (v: number) => Math.round(v * 100) / 100;
  return points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
}

/** A `points` field as it appears on marker *input*: a well-formed, non-empty vertex string (or absent). */
const pointsSchema = z
  .string()
  .max(20_000)
  .refine(isWellFormedPoints, { message: "points must be a non-empty \"x,y x,y ...\" list in the map's pixel space." })
  .optional();

export const mapMarkerDtoSchema = z.object({
  id: z.string(),
  mapNodeId: z.string(),
  shape: markerShapeSchema,
  x: z.number(),
  y: z.number(),
  points: z.string().nullable(),
  label: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  members: z.string().nullable(),
  revealed: z.boolean(),
  /** Reuses fields' 3-value visibility scheme — no creator column here either to key a 'private' level off of. */
  visibility: fieldVisibilitySchema,
  targetNode: z.object({ id: z.string(), title: z.string(), icon: z.string().nullable() }).nullable(),
  parentMarkerId: z.string().nullable(),
});
export type MapMarkerDto = z.infer<typeof mapMarkerDtoSchema>;

export const createMarkerInputSchema = z.object({
  shape: markerShapeSchema.default("pin"),
  x: z.number(),
  y: z.number(),
  points: pointsSchema,
  targetNodeId: z.string().nullable().optional(),
  label: z.string().max(300).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  color: z.string().max(60).nullable().optional(),
  members: z.string().max(2_000).nullable().optional(),
  visibility: fieldVisibilitySchema.default("members"),
  parentMarkerId: z.string().nullable().optional(),
});
export type CreateMarkerInput = z.infer<typeof createMarkerInputSchema>;

export const updateMarkerInputSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    points: pointsSchema,
    targetNodeId: z.string().nullable(),
    label: z.string().max(300).nullable(),
    icon: z.string().max(60).nullable(),
    color: z.string().max(60).nullable(),
    members: z.string().max(2_000).nullable(),
    revealed: z.boolean(),
    visibility: fieldVisibilitySchema,
  })
  .partial();
export type UpdateMarkerInput = z.infer<typeof updateMarkerInputSchema>;

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
// Per-node ACL — additive grants on top of a node's own visibility
// ---------------------------------------------------------------------------

export const ACL_SUBJECT_TYPES = ["user", "role"] as const;
export type AclSubjectType = (typeof ACL_SUBJECT_TYPES)[number];
export const aclSubjectTypeSchema = z.enum(ACL_SUBJECT_TYPES);

export const grantAclInputSchema = z.object({
  subjectType: aclSubjectTypeSchema,
  /** A user id when subjectType is 'user'; a role name when it is 'role'. */
  subjectId: z.string().min(1),
  canRead: z.boolean().default(true),
  canEdit: z.boolean().default(false),
});
export type GrantAclInput = z.infer<typeof grantAclInputSchema>;

export const aclEntryDtoSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  subjectType: aclSubjectTypeSchema,
  subjectId: z.string(),
  /** Resolved for display: the username for a user, the role's label for a role. */
  subjectLabel: z.string(),
  canRead: z.boolean(),
  canEdit: z.boolean(),
  createdAt: z.number().int(),
});
export type AclEntryDto = z.infer<typeof aclEntryDtoSchema>;

// ---------------------------------------------------------------------------
// Anonymous share links — the no-account guest mechanism: a token-bearing URL
// that grants read access to one page's subtree. See ACL above for the
// named-account equivalent.
// ---------------------------------------------------------------------------

export const shareLinkDtoSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  /** First few characters of the token, for telling links apart in a list. */
  prefix: z.string(),
  createdAt: z.number().int(),
  revokedAt: z.number().int().nullable(),
});
export type ShareLinkDto = z.infer<typeof shareLinkDtoSchema>;

/** Returned once, at creation. The plaintext token is never stored or shown again. */
export const createdShareLinkDtoSchema = z.object({
  shareLink: shareLinkDtoSchema,
  token: z.string(),
});
export type CreatedShareLinkDto = z.infer<typeof createdShareLinkDtoSchema>;

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
