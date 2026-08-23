# HANDOFF — read this first

Written 2026-08-21, last updated 2026-08-22, for whoever (human or agent) picks this up
next.

This document is the operating manual: what exists, why it is shaped this way, which
rules must not be broken, and what to build next. The other docs are:

| File | What it holds |
|---|---|
| [PLAN.md](PLAN.md) | The product plan and phase roadmap (P0–P7) |
| [kanka-mapping.md](kanka-mapping.md) | Kanka's model → ours — reference only, no importer is planned (§9.4) |
| [legendkeeper-observations.md](legendkeeper-observations.md) | Field notes from inspecting a live LegendKeeper project |
| [openapi.json](openapi.json) | Generated API contract — regenerate with `npm run openapi` |
| [../README.md](../README.md) | Short version for a newcomer |

---

## 1. What this project is, in one paragraph

A self-hosted worldbuilding / TTRPG campaign web app for a homelab Docker host.
It takes **LegendKeeper's structure** (one freeform tree, anything nests inside anything,
wiki links, maps, timelines, calendars), puts it on **Kanka's self-hosted footing**
(Kanka is the reference implementation — its schema, permission model and API shape are
the source of truth for *how* to build this), and adds the **API + MCP server** that
neither product offers. Obsidian plugins (dataview, kanban, leaflet, fantasy-calendar,
fantasy-statblocks, initiative-tracker, longform, rpg-manager) are **feature references
only** — read them for behaviour and algorithms, never for architecture.

The owner runs a real campaign called **BloodEarth** in Kanka (campaign id `376198`) and
an older world in LegendKeeper. Both are migration sources, not toys.

## 2. The one idea everything rests on

**Everything is a Node. Every view is a query over Nodes.**

- One `nodes` table. `parent_id` is unrestricted — a Character can contain a Map which
  contains a Session. There are no folders; a page with children *is* the folder.
- A node's **kind** (`document` | `map` | `timeline` | `calendar` | `board` | `view` |
  `tag`) picks a renderer. It does **not** pick a table and it does **not** pick a
  location in a menu.
- Type-as-a-facet is the whole point. Kanka's mistake is not its entity spine (that
  spine is *good* — it is why links, tags, posts and permissions are uniform); its
  mistake is that an entity's type decides where it lives in the UI.

If you are about to add a table called `characters`, or a nav section called
"Locations", stop. That is the thing this project exists to avoid.

## 3. Current status

**P0, P1 and P2 are complete, plus a P2.4 editor rewrite.** No bulk importer is planned —
see §9.4.

Verified by:
- `npm test` — 20 unit tests (fractional indexing, wiki-link parsing, secret blocks). All
  pass.
- `npm run smoke` — 112 end-to-end API checks against a running server. All pass —
  unchanged by the P2.4 editor rewrite, which needed zero server changes (see §7.6).
- `npm run test:mcp` — drives the MCP server over stdio, as a real client would. All pass.
- `npm run typecheck` — clean on server, web and mcp.
- `npm run build` — client builds.
- Driven by hand in a browser: login → tree → page → posts → rendered wiki links →
  opened the Members panel, created a brand-new account and added it to the world in one
  step, reset its password, confirmed the login worked with the new password, and
  confirmed the add-form and reset buttons are gone (not just disabled) for a signed-in
  player. The P2.4 editor itself (slash commands, `@`/`[[` linking, secret blocks, DM-notes
  sections, columns, auto-link) was verified separately and thoroughly — see §7.6.

A bug mentioned in a previous version of this doc as "found but not fixed" — the
client's old wikilink regex not skipping inline code spans, so `` `[[double brackets]]` ``
rendered garbled — **is now fixed, as a side effect of the P2.4 editor rewrite**: the new
editor tokenizes markdown through `marked` (via `@tiptap/markdown`), which already
protects code spans before any wikilink tokenizer runs. Nothing was deliberately touched
to fix it; it just stopped being true once the renderer changed.

### Working

- Users identify by **username, not email** — this app is self-hosted with no SMTP,
  ever. Cookie sessions, first-run setup screen, roles per world
  (owner/dm/player/guest)
- Worlds, memberships. A DM's member panel adds someone — creating their account on the
  spot if they do not have one, with a username, name and password the DM sets — or
  resets a member's password outright. Anyone can change their own password given the
  current one. See §7.3
- Nodes: create, read, update, archive, move (re-parent + reorder)
- Unrestricted nesting; drag-and-drop in the sidebar (drop on a row = make child, drop on
  the top/bottom quarter = reorder before/after)
- Markdown bodies with autosave; emoji icons
- `[[Wiki links]]` and `[[Target|label]]`, `[[` autocomplete, backlinks panel,
  unresolved-link tracking (a link to a page that does not exist yet is a to-do, not an
  error, and resolves automatically when that page is created)
- Posts: sections on a page, each with its own visibility — this is the DM-notes feature
- Visibility enforcement: `public` / `members` / `dm` / `private`
- FTS5 search with ranked snippets; Ctrl+K quick switcher
- Content-addressed image upload
- Dockerfile + compose, one image, one `/data` volume
- **Scoped bearer tokens** (P1.1) with a management UI — see §7.1
- **OpenAPI** generated from the Zod schemas: `/api/v1/openapi.json`, `/api/v1/docs`,
  and `npm run openapi` writes `docs/openapi.json` so drift is visible in review
- **MCP server** (`apps/mcp`) over the public HTTP API
- **Inline `:::secret` blocks** (P2, first item) in node and post bodies — see §7.2
- **Username/password accounts, DM-driven, no email** (P2, second item) — see §7.3
- **Per-node ACL overrides, "view as a player," and the DM Menu** (P2, third item) —
  additive-only grants on top of a page's own visibility, plus a preview mode and a
  single sidebar entry point for all of it — see §7.4
- **Anonymous share links** (P2, fourth item) — a no-account guest mechanism, a
  URL-bearing token that reveals one page's subtree — see §7.5
- **A live TipTap document editor** (P2.4) — replaced the P0 textarea + Edit/Preview
  toggle. Always editable in place; `/` slash commands; `@`/`[[` page linking; native
  GM-only secret blocks; inline `/section`/`/dm-notes` embedded posts (retiring the old
  stacked "+ Add a section" list); `/layout` two-column blocks; hover-to-link auto-detect
  of existing page names in plain prose; a "View source" raw-markdown toggle. Needed zero
  server changes — see §7.6

### Not started

Maps, calendars, timelines, templates and typed fields, the query/view engine, boards,
statblocks, initiative, realtime. No importer is planned — see §9.4.

---

## 4. Codebase tour

```
apps/server/
  migrations/0001_init.sql   THE SCHEMA SOURCE OF TRUTH. Hand-written SQL.
  migrations/0002_api_tokens.sql
  migrations/0003_secret_blocks.sql  Drops the FTS insert/update triggers — see §7.2
  migrations/0004_username_accounts.sql  RENAME COLUMN email TO username — see §7.3
  migrations/0005_acl.sql    Per-node ACL overrides — see §7.4
  migrations/0006_share_links.sql  Anonymous share links — see §7.5
  scripts/smoke.mjs          112-check end-to-end API test. Needs an empty data dir.
  src/
    index.ts                 Fastify app: plugins, error handler, static serving, boot
    env.ts                   Config from env vars; refuses prod boot with the dev secret
    db/
      index.ts               node:sqlite connection, pragmas, transaction() helper
      migrate.ts             Applies migrations/*.sql in filename order, once each
      types.ts               Row types mirroring the SQL. Keep in step BY HAND.
    auth/
      password.ts            scrypt hashing
      session.ts             Cookie sessions; DB stores only the token's sha256
      tokens.ts               Bearer tokens: hash, scopes, world pin
      policy.ts              ***THE AUTHORIZATION LAYER*** — read section 6
      viewer.ts              { userId, role } context type
    http/context.ts          requireUser / viewerForWorld / viewerForNode / startSession
                              (also the "view as a player" header — see §7.4)
    lib/
      id.ts                  shortId(8) for nodes, longId(20) for everything else
      sortkey.ts             Fractional indexing (+ tests)
      wikilinks.ts           [[link]] parsing, code-aware (+ tests)
      secrets.ts             :::secret parsing, redaction, the FTS-strip helper (+ tests)
      slug.ts                Slugify + per-world uniqueness
      errors.ts              HttpError + helpers
    services/                Business logic. Routes stay thin.
      nodes.ts               Tree, detail, create/update/move/archive, link + FTS reindexing
      posts.ts               Sections with visibility
      worlds.ts              Worlds, memberships, world creation (makes the root page)
      assets.ts              Content-addressed uploads
      acl.ts                 Per-node access grants — see §7.4
      shareLinks.ts          Anonymous share links — see §7.5
    routes/
      auth.ts                setup, login, logout, me, self-service change-password
      worlds.ts              worlds, tree, search, members (add/create/remove/reset-pw), node create, asset upload
      nodes.ts               node detail/update/move/archive, posts, acl, share-links
      share.ts               the anonymous half of a share link — no auth at all
      tokens.ts              mint / list / revoke API tokens (session only)
      openapi.ts             serves the generated spec + a small viewer

apps/web/
  src/
    api.ts                   The ONLY place the client talks to the server
    App.tsx                  Shell: auth gate, queries, layout, Ctrl+K
    lib/nav.ts               Hand-rolled routing over /n/:nodeId
    lib/markdown.ts          Renders POSTS' bodies (marked → DOMPurify) — the page body
                              itself renders through the TipTap editor now, see editor/
    lib/secrets.ts           Client mirror of the server's secret-block splitter
    lib/postRefs.ts          Finds `:::post {postId=...}:::` markers — see editor/extensions/Section.ts
    editor/                  The live document editor (P2.4) — see §7.6
      context.tsx            EditorPageContext: nodeId/allNodes/canEdit/onCreateNamed,
                              read by every node view below via React context, not
                              TipTap options (which aren't reactive)
      Editor.tsx              Assembles every extension, autosave, image upload/paste/drop,
                              the auto-link hover popover
      extensions/
        WikiLink.ts / WikiLinkView.tsx    `[[Target]]` / `[[Target|Label]]` inline atom —
                              byte-compatible with wikilinks.ts's regex
        WikiLinkSuggestion.ts  `@` (existing only) and `[[` (existing-or-create) —
                              one factory, two configured instances
        SlashCommand.ts / SlashCommandList.tsx   `/` menu
        SecretBlock.ts / SecretBlockView.tsx     `:::secret:::` as a native block
        Section.ts / SectionView.tsx    `/section` `/dm-notes` — an atom referencing a
                              `posts` row, reuses Posts.tsx's PostCard
        Columns.ts / Column.ts          `/layout` — two side-by-side columns
        AutoLink.ts / AutoLinkPopover.tsx   hover-to-link decoration over plain prose
                              matching an existing title
        suggestionPopup.tsx   shared `@tiptap/suggestion` render() factory (floating-ui
                              positioning via `props.mount`)
    components/
      Auth.tsx               Setup + login
      Sidebar.tsx            Tree, filter, drag-and-drop
      NodeView.tsx           Breadcrumb, title, mounts <Editor>, children, + Backlinks rail
      Posts.tsx              Fallback list: posts with no inline `:::post:::` reference
                              (pre-P2.4 sections); PostCard is reused by SectionView
      QuickSwitcher.tsx      Ctrl+K
      Tokens.tsx             API token management
      Members.tsx            DM admin panel: add/create accounts, remove, reset passwords
      Access.tsx             Per-node ACL grants + share link management — see §7.4/§7.5
      ShareView.tsx          The anonymous half of a share link — no session, read-only
      IconPicker.tsx         Emoji picker on the page title

apps/mcp/
  src/index.ts               Entry: reads env, builds the client, stdio transport
  src/client.ts              Typed HTTP client — the ONLY way it reaches the app
  src/tools.ts               Tool definitions
  scripts/integration-test.mjs  Drives the server over stdio like a real client

packages/schema/
  src/index.ts               Zod schemas; every DTO type is inferred from them
  src/openapi.ts             Builds the OpenAPI document from those schemas
```

---

## 5. Data model

Read `apps/server/migrations/0001_init.sql` — it is short and commented. Summary:

```
users        id, username, name, password_hash, is_server_admin, created_at
             (renamed from email in 0004 — see §7.3; the column always just meant
              "login identifier," never actually required an address)
sessions     id (sha256 of token), user_id, created_at, expires_at, user_agent
worlds       id, name, slug, owner_id, settings(JSON), timestamps
memberships  (world_id, user_id) PK, role
assets       id, world_id, sha256, mime, bytes, orig_name, created_by, created_at
templates    id, world_id, name, icon, field_schema(JSON), default_body_md   [unused in P0]
nodes        id, world_id, parent_id, template_id, kind, title, slug, body_md, icon,
             cover_asset_id, sort_key, visibility, is_archived, created_by, timestamps
posts        id, node_id, title, body_md, visibility, sort_key, created_by, timestamps
fields       id, node_id, key, type, value_text, value_num, value_ref, sort_key,
             visibility                                                    [unused in P0]
links        id, world_id, src_node_id, dst_node_id(NULL = unresolved), target_text,
             label, kind, created_at
node_tags    (node_id, tag_node_id) PK
nodes_fts    FTS5 virtual table, maintained by three triggers on `nodes`
acl          id, node_id, subject_type(user|role), subject_id, can_read, can_edit,
             created_by, created_at                                    — see §7.4
share_links  id, node_id, hash(sha256), prefix, created_by, created_at, revoked_at
                                                                        — see §7.5
```

Notes that matter:

- **`nodes.id` is a short 8-char id and appears in URLs** (`/n/ox9119wx`). This is
  deliberate, copied from LegendKeeper: a node can be re-parented or renamed without
  breaking a single inbound link. Slugs are cosmetic. **Do not introduce path-based
  URLs.**
- **`sort_key` is a fractional index string**, not an integer. Inserting between two
  siblings mints a key between theirs, so a drag rewrites exactly one row. See
  `lib/sortkey.ts`. LegendKeeper uses the same technique for map objects (`rank`).
- **`links.dst_node_id` may be NULL.** That is an unresolved wiki link, tracked on
  purpose. `resettleLinksFor()` adopts pending links when a matching page is created or
  renamed, and releases them when it stops matching.
- `templates` and `fields` exist but are **unused in P0**. They are the P3 foundation;
  the tables are there so that phase needs no migration for the basics.
- **SQLite booleans are 0/1 integers.** `is_archived === 1`, not `=== true`.

---

## 6. The rules you must not break

### 6.1 Authorization goes through one layer

`apps/server/src/auth/policy.ts` is the only place that decides who can see what.
Every read path composes `visibilitySqlFor(role, viewerId, ...)` **into the SQL**, so
hidden rows are never selected. They are not fetched-then-filtered, and they are
absolutely never sent to the client to be hidden there.

```
owner / dm  -> public, members, dm   (+ their own private rows)
player      -> public, members       (+ their own private rows)
guest       -> public
not a member-> nothing (the world 404s)
```

`private` is per-row: visible only to `created_by`.

**A hidden node answers 404, not 403.** If it answered 403 you could enumerate the DM's
secrets by probing ids. `requireVisibleNode()` enforces this. Keep it.

When you add a feature, ask: *can DM-only content leak through this?* There are already
four surfaces where it could, and `scripts/smoke.mjs` asserts all four — the tree, a
direct fetch by id, the posts list, and search. **Any new surface (map markers, timeline
entries, query views, graph edges, exports, webhooks) needs the same treatment and the
same test.** This is the single easiest way to ruin this app.

### 6.2 The client uses only the public API

`apps/web/src/api.ts` is the only module that calls the server. No private routes, no
server-rendered escape hatches. This is what structurally guarantees the API stays
complete enough for the MCP server in P1. If the UI needs something the API cannot do,
**add it to the API**, do not special-case the client.

### 6.3 Markdown is the storage format

Bodies are CommonMark + `[[wikilinks]]`. Not editor JSON. It is portable, diffable,
exportable to an Obsidian vault, and an LLM over MCP can read and write it natively.
When the editor is upgraded to TipTap, it must round-trip markdown on load/save.

### 6.4 Migrations are append-only SQL

Add `migrations/000N_whatever.sql` (next is `0004`). Never edit an applied migration.
Update `src/db/types.ts` by hand in the same commit — nothing checks this for you.

### 6.5 A leak surface needs a test in the same commit that opens it

`:::secret` blocks added a fifth place DM content could leak (the FTS index) to the four
named in §6.1. It got the same treatment: excluded from indexing entirely, and
`scripts/smoke.mjs` asserts it. When P4/P5 add map markers and timeline entries, they
need the identical pass before they ship, not after.

---

## 7. API surface (all of it, today)

Base `/api/v1`. Auth is a `dwa_session` cookie. Errors are
`{ error: { code, message, details? } }`.

```
GET    /setup/status                        -> { needsSetup }
POST   /setup                               first run: owner + first world, signs in
POST   /auth/login                          { username, password }
POST   /auth/logout
GET    /auth/me
POST   /auth/change-password                { currentPassword, newPassword } (session only)

GET    /worlds                              worlds you are a member of (+ rootNodeId)
POST   /worlds                              { name }
GET    /worlds/:worldId/tree                the whole visible tree, one query
GET    /worlds/:worldId/search?q=&limit=    FTS5, ranked, with snippets
GET    /worlds/:worldId/unresolved-links    wiki links with no destination yet
POST   /worlds/:worldId/nodes               create a node
GET    /worlds/:worldId/members
POST   /worlds/:worldId/members             { username, role, name?, password? } (owner/dm
                                            only). name+password required only if that
                                            username has no account yet — see §7.3
DELETE /worlds/:worldId/members/:userId     (owner/dm only)
POST   /worlds/:worldId/members/:userId/reset-password
                                            { newPassword } (owner/dm only, member of
                                            that world only)
POST   /worlds/:worldId/assets              multipart, images only, 25 MB cap

GET    /nodes/:nodeId                       detail + breadcrumb + children + backlinks
                                            (bodyMd has :::secret blocks stripped unless
                                             you are owner/dm — see §7.2)
PATCH  /nodes/:nodeId                       title, bodyMd, icon, visibility, templateId,
                                            isArchived. 400 if bodyMd is set and the
                                            existing body has a secret you cannot see.
POST   /nodes/:nodeId/move                  { parentId, afterId?, beforeId? }
DELETE /nodes/:nodeId                       archives the subtree
GET    /nodes/:nodeId/posts                 (same secret redaction as node bodies)
POST   /nodes/:nodeId/posts
PATCH  /posts/:postId                       same 400-if-secret-and-not-dm rule as nodes
DELETE /posts/:postId

GET    /nodes/:nodeId/acl                   grants on this page (owner/dm only) — §7.4
POST   /nodes/:nodeId/acl                   { subjectType, subjectId, canRead, canEdit }
DELETE /nodes/:nodeId/acl/:aclId            revoke a grant

GET    /nodes/:nodeId/share-links           share links on this page (owner/dm only) — §7.5
POST   /nodes/:nodeId/share-links           -> { shareLink, token } — token shown once
DELETE /nodes/:nodeId/share-links/:id       revoke a link

GET    /share/:token/tree                   NO AUTH — the shared subtree, for a visitor
GET    /share/:token/nodes/:nodeId          NO AUTH — one page within that subtree

GET    /tokens                              your tokens (session only)
POST   /tokens                              { name, worldId?, scopes[], expiresInDays? }
                                            -> { token, secret } — secret shown once
DELETE /tokens/:tokenId                     revoke

GET    /healthz                             outside /api, used by the Docker healthcheck
GET    /media/<sha-prefix>/<sha><ext>        uploaded files (NOT /assets — see 8.2)
```

### 7.1 Bearer tokens

`Authorization: Bearer dwa_<64 hex>` works anywhere the session cookie does. Resolved in
`auth/tokens.ts`, wired into `http/context.ts::attachUser`.

**A token acts as its owner and inherits that user's role per world.** Scopes and the
optional world binding only ever *narrow* what the owner could already do — a token can
never grant more than the person holding it has. The visibility rules in §6.1 still apply
underneath, unchanged.

Scopes are hierarchical: `admin` ⊃ `world:write` ⊃ `world:read`.

Enforcement is a single `preHandler` hook in `index.ts`, not per-route:

| Request | Scope needed |
|---|---|
| `GET` / `HEAD` under `/api/v1/` | `world:read` |
| anything else | `world:write` |
| `/api/v1/users*`, any path containing `/members` | `admin` |
| `/api/v1/tokens*` | **refused outright** for token auth |

That last row matters: a token that could mint tokens would be an escalation path around
its own scopes, world binding and expiry. Token management is session-only, by design.

Other properties worth preserving:
- Only the sha256 is stored. The plaintext is returned once at creation, never again.
- A world-pinned token answers **404** for other worlds, not 403 — same reasoning as §6.1.
- Revoked and expired tokens fail as **401**, not 403.
- `last_used_at` is throttled to one write per minute, so reads stay reads.

The UI is `apps/web/src/components/Tokens.tsx`, reached from the sidebar footer. Use it
to mint the token the MCP server will hold — pin it to one world and give it
`world:write`.

### 7.2 Inline `:::secret` blocks

`:::secret` on its own line opens one, a lone `:::` closes it — inside a node's `body_md`
or a post's `body_md`, no new column. Parsed once, in `lib/secrets.ts` on both the server
and the client (the client is a documented duplicate, not the source of truth — the
server's copy is; see the comment at the top of the client one). Built P2, first item, on
direct evidence from a real LegendKeeper world: this pattern was used **70 times** against
3 whole-hidden documents and 5 structured fields — DMs reach for inline secrecy, not
whole-section hiding, and P0 had shipped the least-used mechanism first.

**Read path.** `getNodeDetail` and `listPosts`/`createPost`/`updatePost` all pass the body
through `redactForViewer(bodyMd, canSeeSecrets(viewer.role))` before it leaves the server.
`canSeeSecrets` is `owner`/`dm` only — **role-gated, not authorship-gated**, same as
node/post visibility. That means a player who once typed their own `:::secret` block would
not see it back on their own next fetch. Documented trade-off: consistency with the rest
of the visibility model wins over that edge case.

**Write path.** A body PATCH is a wholesale replace. If the *existing* stored body
contains a secret block and the viewer cannot see secrets, `updateNode`/`updatePost`
reject the whole request with **400**, before touching the row — rather than either
leaking the block to let them "safely" resave, or silently deleting content they cannot
even see. Editing every other field (title, icon, visibility) still works; ask the owner
or a DM to touch the body. New secret blocks written by a non-DM at *creation* time are
allowed (nothing existing to protect yet) — an intentionally narrower guard than it might
first appear.

**Search.** The FTS index is no longer maintained by SQL trigger (see
`migrations/0003_secret_blocks.sql`) — a trigger cannot call `stripSecrets()`. Reindexing
is explicit JS in `services/nodes.ts::reindexFts()`, called after every create and every
title/body update, storing the *stripped* text. Consequence: **secret content is not
searchable by anyone, including the DM.** That is a deliberate simplification (one index,
zero leak surface) over building a second, DM-only index — revisit only if it turns out to
matter in practice.

**Client rendering.** A body a non-DM viewer receives has already had the blocks removed,
so `renderMarkdown` never makes a visibility decision — it only finds segments (via the
client's `lib/secrets.ts`) so a DM's client can wrap them in `.secret-block` (gold border,
"🔒 Secret — DM only" label; see `styles.css`). The editor toolbar has an "Insert secret"
button (`NodeView.tsx` and `Posts.tsx`) that drops in a scaffold and selects the
placeholder text for immediate typing-over. It uses `onMouseDown={preventDefault}` —
without it, `Posts.tsx`'s save-on-blur would fire on the button click itself, saving the
stale body and collapsing out of edit mode before the insertion ever ran.

### 7.3 Accounts: username/password, no email, DM-driven

Decided 2026-08-22: this app is self-hosted with no SMTP, **ever**. There is no
verification email, no password-reset email, and never will be — so a column that only
ever held a unique login string had no business being named `email`, let alone validated
as one. Migration `0004_username_accounts.sql` is `ALTER TABLE users RENAME COLUMN email
TO username` — verified by hand first that SQLite updates the dependent unique index
(`users_email_idx`) to reference the new column name automatically, so this is a rename,
not a schema redesign. `usernameSchema` in `packages/schema` replaces the old
`.email()` validator: 3–32 chars, `[a-zA-Z0-9_.-]+`.

**There is no self-service signup, anywhere, by design.** Two ways an account comes to
exist:

1. **First-run setup** (`POST /setup`) — the owner, once, ever. Unchanged from P0 except
   the field name.
2. **A DM's member panel** (`POST /worlds/:worldId/members`, `components/Members.tsx`) —
   every account after that. `addOrCreateMember` in `services/worlds.ts` does both jobs
   in one call: if `username` already belongs to an account, `name`/`password` are
   ignored and that account is simply added to the world with `role`; if it does not,
   both become required and a brand-new account is created in the same step. This
   replaced what the plan had called an "invite flow" — there is no token, no accept
   link, no email to send one to. A human sets the password directly, the same way a
   homelab admin creates any other login.

**Passwords, without email, need two different reset paths**, both built:

- **Self-service** (`POST /auth/change-password`) — requires the *current* password.
  For someone who still remembers it and just wants to change it.
- **DM-driven** (`POST /worlds/:worldId/members/:userId/reset-password`) — no current
  password needed, for someone who forgot it. There is no other way to recover a
  forgotten password in this app, which is the whole point of not having email. Scoped:
  `resetMemberPassword` checks the target actually has a membership in `worldId` before
  touching anything, so a DM in one world cannot reach into an account that only exists
  in a different one.

**Client-side gating, not just server-side.** `Members.tsx` takes a `canManage` prop
(`world.role === "owner" || world.role === "dm"`, computed in `App.tsx` from the
`WorldDto.role` the tree fetch already returns) and hides the add-form and every
mutating button — not just disables them — when false. Every mutation is independently
enforced server-side regardless (`isGameMaster(viewer.role)` in `routes/worlds.ts`), so
the client-side gate is a UX nicety, not the security boundary; verified by hand as a
signed-in player, not just read from the code.

**A footgun this avoided:** `apps/web/src/api.ts` had been declaring its own inline
parameter types for `setup`/`login` (`{ email: string; password: string }`) instead of
importing `SetupInput`/`LoginInput` from `@dndworldapp/schema`. That meant the rename
compiled clean on both sides while silently sending the wrong field name — TypeScript
had nothing to check it against. Fixed by importing the shared types; if you add a new
auth-adjacent call, import its input type from the schema package rather than inlining
one, or the same drift can happen again undetected.

### 7.4 Per-node ACL, "view as a player," and the DM Menu

**ACL is deliberately additive-only.** `acl.ts`'s `nodeAclSql()` composes as
`visibility OR acl` everywhere a read check happens (`services/nodes.ts::readableSql`) —
there is no deny entry, so a grant can only widen what a page's own visibility already
allows, never narrow it. That sidesteps the precedence question ("does a deny beat a
role-based allow?") entirely, at the cost of not supporting "everyone except this one
player." A grant is keyed on `(node_id, subject_type, subject_id)`; re-granting the same
subject updates the existing row (`ON CONFLICT ... DO UPDATE`) rather than duplicating
it. `subjectType: 'role'` is how "anyone with role X can edit this page" is expressed
without touching the page's visibility for everyone else — `subjectId` is then a role
name (`player`/`guest`; owner/dm already see and edit everything, so granting to them
would be a no-op) rather than a user id.

**A production bug worth knowing about, so it does not recur.** The first version of
`readableSql()` in `services/nodes.ts` built the ACL fragment as
`EXISTS (SELECT 1 FROM acl a WHERE a.node_id = id ...)` for the un-aliased case (used by
`requireVisibleNode`). Because the correlated subquery's own `FROM acl a` **also** has an
`id` column, the bare `id` resolved to `a.id` — the ACL row's own id — not the outer
query's `nodes.id`. Every grant existed in the table but the check was silently comparing
a row's `node_id` to its own `id`, so nothing ever matched. Cost a real debugging pass
(smoke checks failing with "No such node" despite the grant being created and listed
correctly) to find. The fix, and the reason it cannot happen again quietly, is in the
function's own comment: the un-aliased fallback is explicitly `"nodes."`, never `""`.
**Do not "simplify" that qualifier away.**

**"View as a player"** (`http/context.ts::viewerForWorld`) is an `x-view-as: player`
request header, honoured only when the real viewer is already `owner`/`dm`
(`isGameMaster(role)`) — for anyone else it is a no-op, so a player cannot use it to
grant themself anything. It downgrades the *same* `userId` to the `player` role for that
request; it does not simulate a different, anonymous viewer. Consequence worth knowing:
a DM previewing as a player can still edit a page **they themselves created**, since
`canEdit` checks `creatorId === viewerId` regardless of role — but not a page a real
player created. `api.ts` holds it as a module-level flag (`setViewAsPlayer`/
`isViewingAsPlayer`) rather than threading it through every call site; toggling it
invalidates every React Query cache entry, since a stale "what I could edit" from before
the toggle would be actively misleading, not just outdated.

**The DM Menu** (`Sidebar.tsx`) replaced two separate sidebar buttons ("Members," "API
tokens") with one popover containing both plus "view as a player" (owner/dm only) — a
straightforward instruction from the owner to keep the sidebar from accumulating a
button per admin feature as P2 added more of them. Same pattern going forward: new
DM-only surfaces belong inside this menu, not as new top-level sidebar buttons.

The UI is `apps/web/src/components/Access.tsx`, reached from a page's "⋯" menu →
"Access…" (owner/dm only, gated the same way `Members.tsx` is — see §7.3's client-side
gating note, same reasoning applies here).

### 7.5 Anonymous share links

The second guest mechanism from the 2026-08-22 decision in §12 — a real account is one
path, a token-bearing URL needing no account at all is the other. `services/shareLinks.ts`
models it on `auth/tokens.ts`, not on `acl.ts`: a share link identifies a *link*, not a
person or role, so only its sha256 is stored (`share_links.hash`) and the plaintext
token is returned once, at creation, never again.

**A share link grants read to the node it was made on *regardless of that node's own
visibility*** — sharing a `members`- or `dm`-visibility page is the whole point of the
feature. Its subtree, however, only cascades as far as **ordinary guest visibility**
already reaches (`public`, or an explicit `guest`-role ACL grant) — so a DM-only page
nested three levels under a shared root does not leak just because an ancestor was
handed out. This is implemented as its own function
(`shareLinks.ts::getShareScope`/`guestReadableSql`), not a reuse of `readableSql`'s
`visibility OR acl` composition, specifically so the root gets its one-node exception
without that exception silently applying to everything underneath it too.

**A second parameter-ordering bug, same family as §7.4's.** `getShareScope`'s subtree
query binds positional `?` placeholders across three separate places in one SQL string
(the recursive CTE's seed, the child-count subquery, and the root-exception check) — the
first version passed the JS params array in the wrong order (`inner.params` before the
CTE seed instead of after it), so the CTE seeded with a visibility level string instead
of the node id and the subtree resolved to nothing. Caught by the smoke checks (`"nodes":
[]` on a share that should have had two rows), not by TypeScript — `.all(...args)` on a
prepared statement has no way to check that positional order matches the SQL text.
**When a query has more than one place with a `?`, get the JS args array in the exact
same left-to-right order as they appear in the SQL, and say so in a comment**, the way
`getShareScope` now does.

**Route shape.** Management (`GET`/`POST /nodes/:nodeId/share-links`,
`DELETE .../:shareLinkId`) is owner/dm only, alongside the ACL routes. The anonymous half
(`routes/share.ts`: `GET /share/:token/tree`, `GET /share/:token/nodes/:nodeId`) needs no
session or bearer token at all — the token in the URL *is* the credential — and both an
unknown/revoked token and a node outside that particular share's scope answer the same
404, so a valid token cannot be used to probe for ids beyond what was actually shared
(same reasoning as the 404-not-403 rule in §6.1, applied to a second identity mechanism).

**Client.** `ShareView.tsx` is a second top-level branch in `App.tsx`, checked after
every hook (so hook call count stays fixed across renders — see React's rules of hooks)
but before the session-loading gate, so it needs no session at all. **A real bug found
in browser verification and fixed:** `App.tsx`'s "land on the world's root page when no
page is addressed" `useEffect` ran on every render regardless of which JSX branch was
ultimately returned — hooks fire independent of a later conditional `return`. An
already-signed-in DM opening their own share link in the same browser (extremely likely
— it is their own link) got silently redirected away from the share view back to their
own dashboard, because `world?.rootNodeId` resolved once their session/worlds queries
came back. Fixed by gating that effect on `shareToken === null` too. If you add another
early-return branch to `App.tsx`, check whether the effects declared above it need the
same guard — a hook does not know which branch below it will render.

### 7.6 The live document editor (P2.4)

Replaced the P0 textarea + Edit/Preview toggle with TipTap (ProseMirror). Driven by
direct feedback: the toggle "doesn't feel like a real document," and the separate
"+ Add a section"/"+ Add DM notes" buttons should be discovered inline via `/` commands,
not sit as permanent chrome. Ported the *architecture* (not the code — see the licensing
note below) from Kanka's own TipTap editor
(`resources/js/editors/tiptap/` in the local clone, `C:\Users\Wizard\Documents\DNDAPPREF\kanka`):
the `@tiptap/suggestion` + floating popup pattern for both `/` and `@`/`[[` triggers.

**The load-bearing design decision: none of this needed a server change.** Every custom
node either serializes to the exact syntax the server already parses (`[[Title]]`,
`:::secret ... :::`), or to markdown the server was never parsing in the first place
(`:::post {postId=...} :::`, `:::columns:::`/`:::column:::`) — opaque body text either
way. `npm run smoke`'s 112 checks passed unmodified once the editor was built, which is
the whole point: confirmed byte-for-byte compatibility, not just "looks the same."

**Markdown pipeline: `@tiptap/markdown`, not the (unmaintained) community
`tiptap-markdown` package.** TipTap v3.30 ships this as a first-party package
(`marked`-based tokenizing, MIT), with `createBlockMarkdownSpec`/`createAtomBlockMarkdownSpec`
helpers built for exactly this "Pandoc-style `:::name:::` fence" shape — used directly for
`SecretBlock`, `Section`, `Columns`, `Column`. `WikiLink` needed a fully hand-written
`markdownTokenizer`/`parseMarkdown`/`renderMarkdown` instead, since `[[Target|Label]]`
doesn't match either helper's built-in syntax (Pandoc fences or `[name attr]...[/name]`
shortcodes) — see `editor/extensions/WikiLink.ts`. `editor.getMarkdown()` /
`editor.commands.setContent(md, {contentType: 'markdown'})` are the load/save API; these
top-level fields (`parseMarkdown`, `renderMarkdown`, `markdownTokenizer`) go directly on
`Node.create({...})`'s config object, **not** nested under a `markdown:` key — the
`MarkdownManager` reads them via `getExtensionField(extension, 'parseMarkdown')` etc.,
which resolves top-level config fields only. (A JSDoc comment inside `@tiptap/core`
itself shows the nested-key form — that comment does not match the actual runtime
behavior; trust the source, not the doc comment, if they ever diverge again.)

**Two real bugs found in verification, both worth remembering:**
1. **A `?` in a slash-command or `@`/`[[` query silently exits the suggestion.**
   `@tiptap/suggestion`'s `allowSpaces` option defaults to `false`, so typing a space
   after `/dm` (aiming for "DM Notes") or after `@Player` (aiming for a multi-word page
   title) ended the suggestion match early and inserted the literal text instead of
   opening the menu. Fixed by setting `allowSpaces: true` on all three
   (`SlashCommand.ts`, both configured instances of `WikiLinkSuggestion.ts`). If you add
   a fourth trigger, it needs this too, or any multi-word title/command silently breaks.
2. **The auto-link hover popover would close before a mouse could reach its own "Link"
   button.** The ProseMirror plugin reports `hover: null` the instant the cursor leaves
   the decorated span — including when it's moving *toward* the popover, which renders
   outside the ProseMirror DOM entirely (in `Editor.tsx`'s own tree), so `mouseout`'s
   `relatedTarget` is never a descendant of the candidate span. Fixed with a short
   (150 ms) delay before actually clearing hover state, cancelled if the popover's own
   `onMouseEnter` fires first. See `HOVER_HIDE_DELAY_MS` in `Editor.tsx`.

**Section/DM-notes embedding, specifically.** `posts` (the `Posts.tsx` DM-notes feature)
did **not** change shape at all — `/section`/`/dm-notes` still call `api.createPost()`,
still store title/body/visibility exactly as before. The only new thing is a
`:::post {postId="..."} :::` marker in the page's own `body_md`, marking *where* in the
document that post renders — `editor/extensions/Section.ts`'s node view fetches it from
the same `["posts", nodeId]` React Query cache `Posts.tsx` already uses, so there is
exactly one source of truth, not two. **Backward compatibility for posts that predate
this feature**: `Posts.tsx` still renders, but only as a fallback for posts with no
inline reference anywhere in the current body (`lib/postRefs.ts` computes the referenced
id set with a regex over `bodyMd`) — nothing a DM already wrote disappeared, but new
sections are created via slash command only; the static add-buttons are gone.

**Bridging into a non-React plugin lifecycle.** TipTap extension `options` are captured
once at construction and are not reactive; several things (`allNodes`, image upload,
section creation, auto-link hover) need to reach live React state or call `api.ts`/React
Query from inside a `Suggestion`/ProseMirror plugin that isn't a component. The pattern
used throughout (`WikiLinkBridge`, `SlashCommandBridge`, `AutoLinkBridge`): a plain object
built once via `useRef(...).current`, whose methods close over *other* refs
(`allNodesRef.current = allNodes` on every render) so the bridge object itself stays
referentially stable while the data it reads is always current. Click handling inside a
node's own rendered view (`WikiLinkView`, `SectionView`) uses React context
(`editor/context.tsx`) instead, since those genuinely are React components.

**Kanka licensing, since its editor is what this was modeled on:** Kanka's repo
(`C:\Users\Wizard\Documents\DNDAPPREF\kanka`) is `"license": "proprietary"` with a
Commons Clause condition on top (bars selling it or any hosting/consulting service whose
value derives substantially from it) — no open-source grant at all, stricter than even
the GPL repos surveyed for later phases. Only the *architecture* was read and
independently re-implemented against TipTap's own public APIs; nothing was copied. Keep
it that way if this file is ever revisited for another feature Kanka already has.

---

## 8. Environment notes and gotchas

### 8.1 `node:sqlite`, not better-sqlite3

better-sqlite3 needs Visual Studio build tools, which the dev machine does not have, and
would need a build toolchain in the container too. Node 24 ships SQLite 3.50 with FTS5.
Verified working: FTS5 `MATCH` + `snippet()` + `ORDER BY rank`, triggers, recursive CTEs,
CTE-guarded UPDATE, `IS ?` null-safe comparison, bare named parameters (`@id`).

Consequences:
- Scripts pass `--disable-warning=ExperimentalWarning` (node:sqlite prints one).
- There is no `db.transaction()` helper; use `transaction(fn)` from `db/index.ts`
  (savepoint-based, so it nests).
- `stmt.run()` returns `changes` as `number | bigint` — coerce with `Number()`.
- **Row types must be `type` aliases, not `interface`s.** A TypeScript `interface` has no
  implicit index signature, so casting a `node:sqlite` row to it is rejected. This is why
  `db/types.ts` uses `export type XRow = { ... }`. If you add a row type and get
  TS2352, that is why.

### 8.2 `/media`, not `/assets`, for uploads

Vite emits the client bundle into `/assets/`. Mounting uploads there shadowed the bundle
and the server returned `index.html` for `.js` requests. Uploads live at `/media/`.

### 8.3 Node runs the TypeScript directly

No build step for the server. That means:
- Relative imports **must** carry the `.ts` extension.
- Only erasable TypeScript syntax is allowed — no `enum`, no parameter properties, no
  namespaces. `tsconfig.base.json` sets `erasableSyntaxOnly` so `tsc` catches violations.

### 8.4 Windows dev box

Git Bash is available but PowerShell is the primary shell. Heredocs in the Bash tool
mangle apostrophes — write files with an editor tool, not `cat <<EOF`.

### 8.4a Do not sync editor state from props

`NodeView` holds `title`/`body` in local state and must **not** have an effect that
copies them back from `node`. `App` renders it with `key={node.id}`, so navigation
already remounts it with fresh state. An effect keyed on `node.title`/`node.bodyMd` fires
on every autosave — it flipped `editing` back to false about a second after the writer
paused typing, and could clobber keystrokes made while the save was in flight. This was a
real bug; the comment in the file exists to stop it coming back.

### 8.4b Known gap: archiving and inbound links

Archiving a page does not unresolve links that point at it, so those links still render
as normal links rather than reappearing under "Wanted pages". Harmless today (there is no
unarchive UI, and the target 404s cleanly), but worth handling when archive/restore gets
built out properly.

### 8.5 Browser-pane automation quirk

When driving this app through the in-app browser, synthetic clicks at viewport
coordinates land in the wrong place (the pane's screenshot scale disagrees with the
viewport). A real DOM `.click()` on the same element works instantly. This is a tooling
artifact, **not an app bug** — do not go hunting for a UI problem that is not there.

### 8.6 The dev database

`data/` is gitignored. `npm run smoke` needs an **empty** data directory (it calls
`/setup`, which refuses to run twice). Stop the server, delete `data/`, restart, then run
it. On Windows the server holds the file open, so the delete fails until it is stopped.

---

## 9. What to build next — P1 in concrete tasks

P1 is **API tokens + MCP server + the Kanka import**, in that order. It comes before maps
and calendars on purpose: retrofitting an API is misery, and once the MCP server exists
every later phase becomes scriptable and testable.

### 9.1 API tokens — DONE

Migration `0002_api_tokens.sql`, `auth/tokens.ts`, `routes/tokens.ts`, the scope hook in
`index.ts`, and `components/Tokens.tsx`. 14 smoke checks cover it. Details in §7.1.

### 9.2 OpenAPI — DONE

Generated from the Zod schemas in `packages/schema`. The point is that the MCP server and
any future script have a contract, and that drift is visible. See §7.1's sibling note
where the openapi routes were wired.

### 9.3 The MCP server — DONE

`apps/mcp`, a thin adapter over the HTTP API — **never** direct database access, or rule
6.2 rots. stdio transport. Configure with `DNDWORLDAPP_URL`, `DNDWORLDAPP_TOKEN` and
optionally `DNDWORLDAPP_WORLD`.

Registered: `list_worlds`, `get_tree`, `find_nodes`, `get_node`,
`list_unresolved_links`, `create_node`, `update_node`, `move_node`, `archive_node`,
`create_post`, `update_post`. Plus `place_marker`, `add_event` and `advance_calendar`,
which report that they are not built yet — declared on purpose so the eventual shape is
visible.

Two things to preserve when extending it:

- **Everything goes through the API.** `src/client.ts` is the only door. That is what
  makes `npm run test:mcp`'s last assertion true: a read-only token cannot write through
  MCP, because it hits the same scope hook a browser would.
- **`get_tree` renders an indented outline, not JSON.** Far cheaper for a model to read,
  and it keeps ids visible for follow-up calls. Prefer prose-shaped tool output over
  dumping structures.

Streamable HTTP transport is not wired up. stdio covers Claude Desktop and Claude Code;
add HTTP if something needs to reach it over a network.

### 9.4 No bulk importer is planned

The owner runs the campaign in Kanka day to day and already has a Kanka MCP server
connected. Content moves over by hand through both MCP servers as it is needed, not as a
one-shot migration — **do not build `packages/kanka-import` or `packages/lk-import`
unless explicitly asked.**

`kanka-mapping.md` and `legendkeeper-observations.md` are kept as reference material, not
a backlog item: the permission-model mapping in the former and the fully
reverse-engineered export format in the latter are still useful background if a bulk
import is ever wanted after all — both formats are specified well enough to build from
cold. But nothing currently on the roadmap depends on them.

### 9.5 Then, in order

P2 is done (inline secret blocks, DM-driven accounts, per-node ACL, anonymous share
links, "view as a player," the DM Menu — see §7.2–§7.5). Next: P3 templates + query views
→ P4 maps → P5 calendars + timelines → P6 play mode → P7 hardening. See
[PLAN.md](PLAN.md) §8.

---

## 10. Design decisions already made (do not re-litigate without reason)

| Decision | Why |
|---|---|
| SQLite, one file, one volume | Six people at a table. Backup is a file copy. Ports to Postgres later without touching app code. |
| No ORM in P0 | Raw SQL is clearer for recursive CTEs, FTS5 and fractional indexes. Drizzle earns its place at P3 when the view engine needs a dynamic query builder. |
| Markdown, not editor JSON | Portable, diffable, LLM-writable over MCP. |
| Short opaque ids in URLs | Re-parenting must never rot links. Copied from LegendKeeper. |
| Roles + visibility in P0 | Cheap now, miserable to retrofit once content exists. |
| Textarea editor in P0 | The storage format is already final, so swapping in TipTap touches one component. |
| 404 for hidden nodes | 403 would let you enumerate DM content by probing ids. |
| Whole tree in one request | At campaign scale it beats lazy-loading per level, and it makes filtering and Ctrl+K instant. |
| Docker-first | It is the actual deploy target, not a packaging afterthought. |

Things worth stealing from LegendKeeper that are **not built yet** (details in
[legendkeeper-observations.md](legendkeeper-observations.md)):

- Map pins inherit name/icon/colour from the page they link to unless overridden
  (`inherited` + `isSynced`). Rename the page, every pin follows.
- Map objects should be **one typed table with a `kind`** (pin, label, region, path), so
  regions and paths need no new tables later.
- Timeline entries show elapsed gaps ("14 days later") — trivial if dates are stored as
  an absolute integer day count and all display is derived from the calendar schema.
- Their facts sidebar was **empty on every page of a real world** — the author typed
  `Name:` / `Character:` into the body instead. Typed fields must be cheaper than typing
  or nobody will use them, including the owner.

---

## 11. Commands

```bash
npm install
npm run dev:server     # http://localhost:8080  (serves the built client too)
npm run dev:web        # http://localhost:5173  hot-reloading UI, proxies to :8080
npm run build          # build the client
npm test               # unit tests
npm run smoke          # end-to-end API checks; needs an EMPTY data dir + running server
npm run test:mcp       # drives the MCP server over stdio; needs a running server
npm run typecheck      # tsc on server, web and mcp
npm run openapi        # writes docs/openapi.json from the Zod schemas
docker compose up -d --build
```

`SESSION_SECRET` is required in production; generate with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

## 12. Open questions for the owner

1. ~~Guest access shape.~~ **Answered 2026-08-22, both halves now built.** A guest can be
   a real account (a DM creates it the same way as a player, capped at the `guest` role)
   **and**, separately, an anonymous visitor on a share link scoped to one page's
   subtree, needing no account at all — built as its own lightweight, no-auth endpoint
   (`routes/share.ts`) rather than threading guest+subtree scoping through the existing
   tree/search/detail query surface. See §7.5.
2. **Multiple worlds.** The schema supports many worlds per server, but the client shows
   only the first. Is a world switcher wanted, or is this a one-world install?
3. ~~Kanka cutover.~~ **Answered 2026-08-22:** no bulk migration. The owner keeps running
   the campaign in Kanka and moves content over by hand through both MCP servers as it is
   needed. See §9.4.
4. **Obsidian.** Is a two-way Obsidian vault sync wanted, or is one-time import/export
   enough? Two-way is a much bigger commitment.
