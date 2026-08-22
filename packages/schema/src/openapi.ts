import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as S from "./index.ts";

/**
 * The OpenAPI document, generated from the Zod schemas rather than maintained by
 * hand. If a route's contract changes and this file is not updated, the diff on
 * `docs/openapi.json` makes the drift visible in review — which is the point.
 */

type Json = Record<string, unknown>;

const registry = new Map<string, ZodTypeAny>();

/** Register a schema as a reusable component and return a `$ref` to it. */
function ref(name: string, schema: ZodTypeAny): Json {
  registry.set(name, schema);
  return { $ref: `#/components/schemas/${name}` };
}

const Visibility = ref("Visibility", S.visibilitySchema);
const Role = ref("Role", S.roleSchema);
const NodeKind = ref("NodeKind", S.nodeKindSchema);
const Scope = ref("Scope", S.scopeSchema);
const UserDto = ref("UserDto", S.userDtoSchema);
const WorldDto = ref("WorldDto", S.worldDtoSchema);
const MemberDto = ref("MemberDto", S.memberDtoSchema);
const NodeSummary = ref("NodeSummary", S.nodeSummarySchema);
const NodeDetail = ref("NodeDetail", S.nodeDetailSchema);
const PostDto = ref("PostDto", S.postDtoSchema);
const SearchHit = ref("SearchHit", S.searchHitSchema);
const UnresolvedLink = ref("UnresolvedLink", S.unresolvedLinkSchema);
const TokenDto = ref("TokenDto", S.tokenDtoSchema);
const AssetDto = ref("AssetDto", S.assetDtoSchema);
const ApiError = ref("ApiError", S.apiErrorSchema);

const SetupInput = ref("SetupInput", S.setupInputSchema);
const LoginInput = ref("LoginInput", S.loginInputSchema);
const ChangePasswordInput = ref("ChangePasswordInput", S.changePasswordInputSchema);
const CreateWorldInput = ref("CreateWorldInput", S.createWorldInputSchema);
const AddMemberInput = ref("AddMemberInput", S.addMemberInputSchema);
const ResetPasswordInput = ref("ResetPasswordInput", S.resetPasswordInputSchema);
const CreateNodeInput = ref("CreateNodeInput", S.createNodeInputSchema);
const UpdateNodeInput = ref("UpdateNodeInput", S.updateNodeInputSchema);
const MoveNodeInput = ref("MoveNodeInput", S.moveNodeInputSchema);
const CreatePostInput = ref("CreatePostInput", S.createPostInputSchema);
const UpdatePostInput = ref("UpdatePostInput", S.updatePostInputSchema);
const CreateTokenInput = ref("CreateTokenInput", S.createTokenInputSchema);

const obj = (properties: Json, required?: string[]): Json => ({
  type: "object",
  properties,
  ...(required ? { required } : {}),
});

const arr = (items: Json): Json => ({ type: "array", items });

const json = (schema: Json): Json => ({ content: { "application/json": { schema } } });

const body = (schema: Json, required = true): Json => ({
  required,
  ...json(schema),
});

const ok = (schema: Json, description = "Success"): Json => ({
  description,
  ...json(schema),
});

const pathParam = (name: string, description: string): Json => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" },
  description,
});

const ERRORS: Json = {
  400: { description: "Invalid input", ...json(ApiError) },
  401: { description: "Not signed in, or the token is unknown, revoked or expired", ...json(ApiError) },
  403: { description: "Signed in, but not allowed — including a token missing a scope", ...json(ApiError) },
  404: {
    description:
      "Not found. Also returned for things the caller may not see, so ids cannot be probed.",
    ...json(ApiError),
  },
  409: { description: "Conflict", ...json(ApiError) },
};

const paths: Json = {
  "/setup/status": {
    get: {
      tags: ["setup"],
      summary: "Whether this server still needs its first account",
      security: [],
      responses: { 200: ok(obj({ needsSetup: { type: "boolean" } }, ["needsSetup"])) },
    },
  },
  "/setup": {
    post: {
      tags: ["setup"],
      summary: "First run: create the owner account and their first world, and sign in",
      security: [],
      requestBody: body(SetupInput),
      responses: {
        200: ok(obj({ user: UserDto, worldId: { type: "string" } }, ["user", "worldId"])),
        ...ERRORS,
      },
    },
  },
  "/auth/login": {
    post: {
      tags: ["auth"],
      summary: "Sign in and receive a session cookie",
      security: [],
      requestBody: body(LoginInput),
      responses: { 200: ok(obj({ user: UserDto }, ["user"])), ...ERRORS },
    },
  },
  "/auth/logout": {
    post: { tags: ["auth"], summary: "Sign out", responses: { 200: ok(ref("Ok", S.okSchema)) } },
  },
  "/auth/me": {
    get: {
      tags: ["auth"],
      summary: "The signed-in user, or the token's owner",
      responses: { 200: ok(obj({ user: UserDto }, ["user"])), ...ERRORS },
    },
  },
  "/auth/change-password": {
    post: {
      tags: ["auth"],
      summary: "Change your own password",
      description:
        "Requires the current password. Session only — there is no email to send a reset link to. A DM resetting a member's forgotten password uses POST /worlds/{worldId}/members/{userId}/reset-password instead.",
      security: [{ sessionCookie: [] }],
      requestBody: body(ChangePasswordInput),
      responses: { 200: ok(ref("Ok", S.okSchema)), ...ERRORS },
    },
  },

  "/worlds": {
    get: {
      tags: ["worlds"],
      summary: "Worlds the caller is a member of",
      responses: { 200: ok(obj({ worlds: arr(WorldDto) }, ["worlds"])), ...ERRORS },
    },
    post: {
      tags: ["worlds"],
      summary: "Create a world, with a root page",
      requestBody: body(CreateWorldInput),
      responses: { 200: ok(obj({ world: WorldDto }, ["world"])), ...ERRORS },
    },
  },
  "/worlds/{worldId}/tree": {
    get: {
      tags: ["worlds"],
      summary: "Every page in the world the caller may see, in one request",
      description:
        "Returns the whole visible tree. Cheaper than lazy-loading each level, and it makes filtering and the quick switcher instant. Rows the caller may not see are filtered in SQL and never sent.",
      parameters: [pathParam("worldId", "World id")],
      responses: { 200: ok(obj({ nodes: arr(NodeSummary) }, ["nodes"])), ...ERRORS },
    },
  },
  "/worlds/{worldId}/search": {
    get: {
      tags: ["worlds"],
      summary: "Full-text search across pages the caller may see",
      parameters: [
        pathParam("worldId", "World id"),
        { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Query. Each word is matched as a prefix." },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
      ],
      responses: { 200: ok(obj({ hits: arr(SearchHit) }, ["hits"])), ...ERRORS },
    },
  },
  "/worlds/{worldId}/unresolved-links": {
    get: {
      tags: ["worlds"],
      summary: "Wiki links pointing at pages that do not exist yet",
      description: "A to-do list rather than an error. Creating a matching page resolves them automatically.",
      parameters: [pathParam("worldId", "World id")],
      responses: { 200: ok(obj({ links: arr(UnresolvedLink) }, ["links"])), ...ERRORS },
    },
  },
  "/worlds/{worldId}/nodes": {
    post: {
      tags: ["nodes"],
      summary: "Create a page",
      parameters: [pathParam("worldId", "World id")],
      requestBody: body(CreateNodeInput),
      responses: {
        201: ok(
          obj({
            node: obj(
              { id: { type: "string" }, title: { type: "string" }, parentId: { type: "string", nullable: true } },
              ["id", "title"],
            ),
          }),
        ),
        ...ERRORS,
      },
    },
  },
  "/worlds/{worldId}/members": {
    get: {
      tags: ["members"],
      summary: "Who is in this world",
      parameters: [pathParam("worldId", "World id")],
      responses: { 200: ok(obj({ members: arr(MemberDto) }, ["members"])), ...ERRORS },
    },
    post: {
      tags: ["members"],
      summary: "Add someone to this world, creating their account if they do not have one yet",
      description:
        "Owner or DM only. Tokens need the `admin` scope. If `username` already belongs to an account, `name`/`password` are ignored and that account is simply added with `role`. Otherwise both become required and a brand-new account is created in the same step — there is no email invite; a human always sets the account up directly.",
      parameters: [pathParam("worldId", "World id")],
      requestBody: body(AddMemberInput),
      responses: { 201: ok(obj({ member: MemberDto }, ["member"])), ...ERRORS },
    },
  },
  "/worlds/{worldId}/members/{userId}": {
    delete: {
      tags: ["members"],
      summary: "Remove someone from this world",
      parameters: [pathParam("worldId", "World id"), pathParam("userId", "User id")],
      responses: { 200: ok(ref("Ok", S.okSchema)), ...ERRORS },
    },
  },
  "/worlds/{worldId}/members/{userId}/reset-password": {
    post: {
      tags: ["members"],
      summary: "Reset a member's password",
      description:
        "Owner or DM only, and only for members of this world. There is no email to send a reset link to, so this is how a forgotten password gets fixed.",
      parameters: [pathParam("worldId", "World id"), pathParam("userId", "User id")],
      requestBody: body(ResetPasswordInput),
      responses: { 200: ok(ref("Ok", S.okSchema)), ...ERRORS },
    },
  },
  "/worlds/{worldId}/assets": {
    post: {
      tags: ["assets"],
      summary: "Upload an image",
      description: "Multipart. Content-addressed, so the same file uploaded twice costs one copy on disk.",
      parameters: [pathParam("worldId", "World id")],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: obj({ file: { type: "string", format: "binary" } }, ["file"]),
          },
        },
      },
      responses: { 200: ok(obj({ asset: AssetDto }, ["asset"])), ...ERRORS },
    },
  },

  "/nodes/{nodeId}": {
    get: {
      tags: ["nodes"],
      summary: "A page, with its breadcrumb, children and backlinks",
      parameters: [pathParam("nodeId", "Node id")],
      responses: { 200: ok(obj({ node: NodeDetail }, ["node"])), ...ERRORS },
    },
    patch: {
      tags: ["nodes"],
      summary: "Update a page",
      parameters: [pathParam("nodeId", "Node id")],
      requestBody: body(UpdateNodeInput),
      responses: { 200: ok(obj({ node: NodeDetail }, ["node"])), ...ERRORS },
    },
    delete: {
      tags: ["nodes"],
      summary: "Archive a page and everything inside it",
      parameters: [pathParam("nodeId", "Node id")],
      responses: { 200: ok(ref("Ok", S.okSchema)), ...ERRORS },
    },
  },
  "/nodes/{nodeId}/move": {
    post: {
      tags: ["nodes"],
      summary: "Re-parent and/or reorder a page",
      description:
        "Give the target parent and, optionally, the siblings to sit between. The server mints a fractional sort key, so no sibling rows are rewritten. Moving a page inside its own descendant is rejected.",
      parameters: [pathParam("nodeId", "Node id")],
      requestBody: body(MoveNodeInput),
      responses: {
        200: ok(
          obj({
            node: obj({
              id: { type: "string" },
              parentId: { type: "string", nullable: true },
              sortKey: { type: "string" },
            }),
          }),
        ),
        ...ERRORS,
      },
    },
  },
  "/nodes/{nodeId}/posts": {
    get: {
      tags: ["posts"],
      summary: "Sections on a page that the caller may see",
      description: "Hidden sections are filtered in SQL — a player's browser never receives DM notes.",
      parameters: [pathParam("nodeId", "Node id")],
      responses: { 200: ok(obj({ posts: arr(PostDto) }, ["posts"])), ...ERRORS },
    },
    post: {
      tags: ["posts"],
      summary: "Add a section to a page",
      parameters: [pathParam("nodeId", "Node id")],
      requestBody: body(CreatePostInput),
      responses: { 201: ok(obj({ post: PostDto }, ["post"])), ...ERRORS },
    },
  },
  "/posts/{postId}": {
    patch: {
      tags: ["posts"],
      summary: "Update a section",
      parameters: [pathParam("postId", "Post id")],
      requestBody: body(UpdatePostInput),
      responses: { 200: ok(obj({ post: PostDto }, ["post"])), ...ERRORS },
    },
    delete: {
      tags: ["posts"],
      summary: "Delete a section",
      parameters: [pathParam("postId", "Post id")],
      responses: { 200: ok(ref("Ok", S.okSchema)), ...ERRORS },
    },
  },

  "/tokens": {
    get: {
      tags: ["tokens"],
      summary: "Your API tokens",
      description: "Session only. A token cannot manage tokens.",
      security: [{ sessionCookie: [] }],
      responses: { 200: ok(obj({ tokens: arr(TokenDto) }, ["tokens"])), ...ERRORS },
    },
    post: {
      tags: ["tokens"],
      summary: "Mint a token; the secret is returned once and never again",
      security: [{ sessionCookie: [] }],
      requestBody: body(CreateTokenInput),
      responses: {
        201: ok(obj({ token: TokenDto, secret: { type: "string" } }, ["token", "secret"])),
        ...ERRORS,
      },
    },
  },
  "/tokens/{tokenId}": {
    delete: {
      tags: ["tokens"],
      summary: "Revoke a token",
      security: [{ sessionCookie: [] }],
      parameters: [pathParam("tokenId", "Token id")],
      responses: { 200: ok(ref("Ok", S.okSchema)), ...ERRORS },
    },
  },
};

export function buildOpenApiDocument(version = "0.1.0"): Json {
  // Registration happens as a side effect of the `ref()` calls above, so the
  // component map is complete by the time this runs.
  const schemas: Json = {};
  for (const [name, schema] of registry) {
    const generated = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" }) as Json;
    delete generated.$schema;
    schemas[name] = generated;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "DNDWORLDAPP API",
      version,
      description: [
        "Self-hosted worldbuilding and campaign API.",
        "",
        "Two ways to authenticate: a `dwa_session` cookie for the browser, or",
        "`Authorization: Bearer <token>` for scripts and the MCP server.",
        "",
        "A token acts as its owner and inherits that user's role in each world.",
        "Scopes and the optional world pin only ever *narrow* that — a token can",
        "never grant more than the person holding it has.",
        "",
        "Things the caller may not see answer 404 rather than 403, so ids cannot",
        "be probed to discover hidden content.",
        "",
        "This document is generated from the Zod schemas in packages/schema.",
      ].join("\n"),
    },
    servers: [{ url: "/api/v1" }],
    security: [{ sessionCookie: [] }, { bearerToken: [] }],
    tags: [
      { name: "setup", description: "First-run bootstrap" },
      { name: "auth", description: "Sessions" },
      { name: "worlds", description: "Worlds, the tree, and search" },
      { name: "nodes", description: "Pages — the spine of the app" },
      { name: "posts", description: "Sections on a page, each with its own visibility" },
      { name: "members", description: "Who is in a world, and their role" },
      { name: "tokens", description: "API tokens for scripts and MCP" },
      { name: "assets", description: "Uploads" },
    ],
    paths,
    components: {
      schemas,
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "dwa_session" },
        bearerToken: {
          type: "http",
          scheme: "bearer",
          description: "A token from POST /tokens. Format: `dwa_` followed by 64 hex characters.",
        },
      },
    },
  };
}

/** Unused here, but keeps `Visibility` and friends referenced for the registry. */
export const REGISTERED_COMPONENTS = [Visibility, Role, NodeKind, Scope] as const;
