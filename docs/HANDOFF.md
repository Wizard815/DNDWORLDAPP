# HANDOFF — read this first

Written 2026-08-21, last updated 2026-08-23, for whoever (human or agent) picks this up
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

**P0, P1 and P2 are complete, plus a P2.4 editor rewrite, P3's templates/typed fields, and
P4.1–P4.3 and P4.5 of maps (source image + typed markers with inheritance, background
tiling for large images, labeled/colored region/zone polygons with full per-vertex
editing, and party/army tokens with group-dominant visibility — fog and layers, P4.4 and
P4.6, are not built yet).** No bulk importer is planned — see §9.4.

Verified by:
- `npm test` — 31 unit tests (fractional indexing, wiki-link parsing, secret blocks, and
  the P4.3 marker-points parser). All pass.
- `npm run smoke` — 193 end-to-end API checks against a running server, run against an
  empty data dir. All pass — includes the `== templates & typed fields ==` section added
  for P3 (see §7.7) and the `== maps ==` section added for P4.1 (see §7.8), now extended
  with the P4.3 polygon/region block and its DM-leak assertion.
- `npm run test:mcp` — drives the MCP server over stdio, as a real client would. All
  pass (57 checks, incl. the P4.3 place→read→redraw→reject→delete polygon flow).
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
  toggle. Always editable in place, nothing here has an Edit button; `/` slash commands;
  `@`/`[[` page linking; native GM-only secret blocks with a "Reveal" button that
  permanently un-hides one in place; `/section` embeds a player-visible post inline
  (retiring the old stacked "+ Add a section" list); `/dm-notes` is the same secret-block
  mechanism as `/secret`, not a separate post; `/layout` two-column blocks;
  hover-to-link auto-detect of existing page names in plain prose; a "View source"
  raw-markdown toggle. Needed zero server changes — see §7.6
- **Network failures surface a real message, not "Something went wrong."** — a
  `fetch()` that never reaches the server (down, unreachable, connection refused) used to
  throw a raw `TypeError` that every `catch (err) { err instanceof ApiError ? ... }` call
  site fell through to its own generic fallback text, indistinguishable from a real
  validation error. `api.ts`'s `request()`/`uploadAsset()` now wrap the `fetch()` call
  itself, not just non-OK responses, so this is fixed at the one shared choke point.
- **Field-definition templates and typed per-node fields** (P3, first item) — a
  world-scoped `Template` (named, ordered field definitions) instantiates per-node
  `fields` rows when assigned; DM Menu → Templates to author one, a node's "⋯" menu to
  assign/re-apply. Fields render inline with no Edit/Save toggle, same as everything
  else. See §7.7.
- **Maps: source image, tiling, typed/inheriting markers, editable region polygons,
  party/army tokens** (P4, sub-phases 1–3 and 5) — a `kind="map"` node renders through
  Leaflet `CRS.Simple`, swaps to a `sharp`-generated tile pyramid past 2000px, and
  carries `pin`/`label`/`circle`/`token` markers that link to any node and inherit its
  title/icon unless overridden, plus drawable, labeled/colored `polygon`/`path`
  region/zone shapes with full editing (per-vertex dragging, click-a-line-to-split,
  freehand draw, redraw from the inspector, server-validated vertex counts). `token`
  markers can be grouped under another token via a self-referential `parent_marker_id`
  (a party splitting into squads), with group-dominant visibility — hiding the parent
  hides every descendant regardless of its own visibility setting. "+ New map" in the
  sidebar, "Add a map inside" in a node's "⋯" menu, a "🖼 Replace image" button in the
  map toolbar to swap a map's source image after the fact. See §7.8.

### Not started

Fog of war/layers (P4.4/P4.6), calendars, timelines, the query/view
engine (table/board/gallery), statblocks, initiative, realtime. No importer is planned
— see §9.4.

### Known open items (check these before starting new work)

- **In progress, 2026-08-25 — map display groups (Kanka's `MapGroup`), server side
  only.** Requested directly by the owner, referencing their own Kanka campaign's map
  groups panel (toggle categories of markers on/off, control their stacking order).
  Migration `0010` (`map_groups` table + `map_markers.group_id`),
  `services/mapGroups.ts` (full CRUD, cycle-checked nesting via `parent_group_id`,
  fractional-index `sort_key` doubling as z-order), the routes in `routes/maps.ts`, and
  the `apps/web/src/api.ts` client methods are all done and typecheck/smoke-test clean.
  **The client has no UI for any of this yet** — no panel to see/create/toggle/reorder
  groups, no "assign to a group" control in the marker inspector, and the MCP server
  has no group tools. This was a deliberate stopping point mid-feature, not an
  oversight — pick up by building `MapView.tsx`'s groups panel next (a toggle button in
  the map toolbar, a nested checklist with up/down reorder, a "Group" dropdown in
  `MarkerInspector` alongside the existing "Group (parent token)" one — these are two
  different dropdowns for two different features, see PLAN.md item 6's note on why).
  The one design decision already made and worth preserving: a group's on/off toggle is
  **personal, per-viewer, client-side-only** (`localStorage`, same mechanism as
  `usePinned`) — the owner chose this explicitly over a shared server-side toggle, so a
  player decluttering their own view never hides anything for anyone else. Groups
  themselves (name/color/order/membership) remain shared map data like markers.
- **Resolved 2026-08-24**: the broader best-practices/other-bugs audit that had been
  owed since an earlier session (redirected onto the UI-feedback batch in §7.9, then a
  push-and-stop, then the P4.3-patch evaluation) finally ran — see
  `docs/AUDIT-2026-08-24.md`. Five real leak surfaces and four correctness bugs found,
  all fixed the same day with a regression assertion added to `smoke.mjs` per §6.5
  for each. One item (`@fastify/static`'s CVEs) was deliberately deferred — confirmed
  non-exploitable in this app's configuration, and a major version bump felt like the
  wrong risk to take without a changelog review.
- **Unconfirmed**: sidebar "⋯" / top-bar "Page actions" / right-click reported
  unresponsive around the map page, in the owner's own browser. Not reproduced in
  automated testing this session — see §7.8's last paragraph for what was tried and the
  leading (stale-tab) theory. Get a hard-refresh confirmation and, if it still happens,
  exact repro steps before touching anything.
- **Resolved 2026-08-24**: "the map still looks bad" is not a vague visual quibble — it
  was a real, previously-undetected tile-coordinate transposition bug. See §7.8's map
  section for the full root cause and fix; the short version is that `sharp`'s tile
  output and `MapView.tsx`'s `<TileLayer>` URL disagreed about which axis was which, and
  every non-square map (i.e. almost every real one) was rendering scrambled/incomplete
  at deep zoom. Root-caused with a purpose-built grid-and-quadrant test image rather than
  a screenshot, fixed, and now covered by a `smoke.mjs` regression that would fail if
  this axis order regresses again.

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
  migrations/0007_fields_unique_key.sql  UNIQUE(node_id, key) on fields — see §7.7
  migrations/0008_maps.sql   maps, map_markers, map_layers, assets.width/height — §7.8
  scripts/smoke.mjs          193-check end-to-end API test. Needs an empty data dir.
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
      templates.ts           Field-definition templates + instantiation — see §7.7
      fields.ts              Typed per-node field values — see §7.7
      maps.ts                Map image + typed markers (incl. region/zone polygons),
                              inheritance + point validation at read/write time — §7.8
    routes/
      auth.ts                setup, login, logout, me, self-service change-password
      worlds.ts              worlds, tree, search, members (add/create/remove/reset-pw),
                              node create, asset upload, templates (CRUD)
      nodes.ts               node detail/update/move/archive, posts, acl, share-links,
                              fields (CRUD/move/apply-template)
      maps.ts                map image (GET/PUT), markers (CRUD) — see §7.8
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
        SecretBlock.ts / SecretBlockView.tsx     `:::secret:::` as a native block, with
                              a "Reveal" button — `/secret` AND `/dm-notes` both insert
                              this same node, see §7.6
        Section.ts / SectionView.tsx    `/section` only — an atom referencing a
                              `posts` row, reuses Posts.tsx's PostCard
        Columns.ts / Column.ts          `/layout` — two side-by-side columns
        AutoLink.ts / AutoLinkPopover.tsx   hover-to-link decoration over plain prose
                              matching an existing title
        suggestionPopup.tsx   shared `@tiptap/suggestion` render() factory (floating-ui
                              positioning via `props.mount`)
    components/
      Auth.tsx               Setup + login
      Sidebar.tsx            Tree, filter, drag-and-drop, DM Menu (incl. Templates entry),
                              "+ New map" — see §7.8
      NodeView.tsx           Breadcrumb, title, mounts <Editor> OR <MapView> by
                              node.kind (the first-ever kind dispatch — see §7.8),
                              children, "⋯" menu (incl. Template picker/re-apply, "Add a
                              map inside"); exports Backlinks, which also renders
                              FieldsPanel — see §7.7
      Templates.tsx          DM Menu → Templates: the template field-schema editor — §7.7
      MapView.tsx            Leaflet CRS.Simple map + typed marker CRUD — see §7.8
      Posts.tsx              Fallback list: posts with no inline `:::post:::` reference
                              (pre-P2.4 sections); PostCard is reused by SectionView
      QuickSwitcher.tsx      Ctrl+K
      Tokens.tsx             API token management
      Members.tsx            DM admin panel: add/create accounts, remove, reset passwords
      Access.tsx             Per-node ACL grants + share link management — see §7.4/§7.5
      ShareView.tsx          The anonymous half of a share link — no session, read-only
      IconPicker.tsx         Emoji picker on the page title (also reused by Templates.tsx)

apps/mcp/
  src/index.ts               Entry: reads env, builds the client, stdio transport
  src/client.ts              Typed HTTP client — the ONLY way it reaches the app
  src/tools.ts               Tool definitions, incl. list_templates/set_node_template/
                              set_field/apply_template (§7.7), get_map/place_marker/
                              update_marker/delete_marker (§7.8)
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
assets       id, world_id, sha256, mime, bytes, orig_name, width, height, created_by,
             created_at  — width/height added 0008, nullable, lazily backfilled — §7.8
templates    id, world_id, name, icon, field_schema(JSON), default_body_md   — see §7.7
nodes        id, world_id, parent_id, template_id, kind, title, slug, body_md, icon,
             cover_asset_id, sort_key, visibility, is_archived, created_by, timestamps
posts        id, node_id, title, body_md, visibility, sort_key, created_by, timestamps
fields       id, node_id, key, type, value_text, value_num, value_ref, sort_key,
             visibility, UNIQUE(node_id, key) from 0007                    — see §7.7
links        id, world_id, src_node_id, dst_node_id(NULL = unresolved), target_text,
             label, kind, created_at
node_tags    (node_id, tag_node_id) PK
nodes_fts    FTS5 virtual table, maintained by three triggers on `nodes`
acl          id, node_id, subject_type(user|role), subject_id, can_read, can_edit,
             created_by, created_at                                    — see §7.4
share_links  id, node_id, hash(sha256), prefix, created_by, created_at, revoked_at
                                                                        — see §7.5
maps         node_id (PK), asset_id, min_zoom, max_zoom, tiling_status, tiling_error,
             fog_enabled, fog_mask_updated_at, timestamps               — see §7.8
map_markers  id, map_node_id, layer_id, target_node_id, parent_marker_id, shape, x, y,
             points, label, icon, color, members, revealed, visibility, created_by,
             timestamps                                                — see §7.8
map_layers   id, map_node_id, name, asset_id, is_overlay, opacity, sort_key, is_default,
             created_at  — table exists, unused until P4.6              — see §7.8
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
- `templates` and `fields` sat unused since P0 — they are now in use as of P3; see §7.7.
- `map_markers` is **one typed table with a `shape` discriminator**
  (pin/label/circle/polygon/path/token), not a table per shape — same reasoning as
  `fields` covering every field type in one table. See §7.8.
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
GET    /worlds/:worldId/templates           any member — see §7.7
POST   /worlds/:worldId/templates           { name, icon?, fieldSchema, defaultBodyMd } (owner/dm only)
PATCH  /worlds/:worldId/templates/:id       (owner/dm only) — never touches nodes already
                                            instantiated from this template, see §7.7
DELETE /worlds/:worldId/templates/:id       (owner/dm only) — nulls nodes.templateId,
                                            leaves their fields' values intact

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

GET    /nodes/:nodeId/fields                typed field values, visibility-filtered — §7.7
POST   /nodes/:nodeId/fields                { key, type, value?, visibility } — ad hoc only,
                                            rejects type "select" (options come from a
                                            template only)
PATCH  /nodes/:nodeId/fields/:fieldId       { value?, visibility? } — key/type are fixed
DELETE /nodes/:nodeId/fields/:fieldId
POST   /nodes/:nodeId/fields/:fieldId/move  { afterId?, beforeId? }
POST   /nodes/:nodeId/apply-template        backfills missing template fields onto this
                                            node without disturbing values already set;
                                            400 if the node has no template

GET    /nodes/:nodeId/map                   map detail (source image, pixel bounds,
                                            tiling status) — §7.8. 404 if none set
PUT    /nodes/:nodeId/map                   { assetId } — set/replace the map's source
                                            image (canEditNode gate)
GET    /nodes/:nodeId/map/markers           visibility-filtered — §7.8
POST   /nodes/:nodeId/map/markers           { shape, x, y, targetNodeId?, label?, icon?,
                                            color?, points? (polygon/path only), members?,
                                            visibility } — points validated per shape, see §7.8
PATCH  /markers/:markerId                   (canEditNode on the owning map node)
DELETE /markers/:markerId

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

**`/section` embedding.** `posts` (the `Posts.tsx` feature) did **not** change shape at
all — `/section` still calls `api.createPost()`, still stores title/body/visibility
exactly as before. The only new thing is a `:::post {postId="..."} :::` marker in the
page's own `body_md`, marking *where* in the document that post renders —
`editor/extensions/Section.ts`'s node view fetches it from the same `["posts", nodeId]`
React Query cache `Posts.tsx` already uses, so there is exactly one source of truth, not
two. **Backward compatibility for posts that predate this feature**: `Posts.tsx` still
renders, but only as a fallback for posts with no inline reference anywhere in the
current body (`lib/postRefs.ts` computes the referenced id set with a regex over
`bodyMd`) — nothing a DM already wrote disappeared, but new player-visible sections are
created via slash command only; the static add-button is gone.

**`/dm-notes` is not backed by a post at all — it's the same mechanism as `/secret`,
just a second menu entry for it.** First cut had it call `api.createPost()` the same way
`/section` does, with a `postSection` reference node and its own visibility dropdown —
then direct feedback: it should have no Edit button (nothing here should — see the P2.4
mission statement above), should be a plain fenced block in the markdown like a secret
already is, and should be freely editable in place like the rest of the document. Since
"hidden from non-DM, editable inline, no separate table" is *exactly* what `SecretBlock`
already does, `/dm-notes` was rewired to insert a `secretBlock` node directly — same
node type, same `:::secret ... :::` fence, same "🔒 Secret — DM only" rendering as
`/secret`. There is no stored attribute distinguishing "this was a DM note" from "this
was a secret" — after a reload they're genuinely the same thing, which is correct: they
always were.

**Reveal** (`SecretBlockView.tsx`) is the one new capability this added, and it applies
to every secret block regardless of which slash command created it: it un-hides the
block permanently by deleting the node and re-inserting its own content (`node.content
.toJSON()`) at the same position via `editor.chain().insertContentAt({from, to},
content)` — the fence is gone, the prose becomes normal, visible body text. One-way, the
same as changing a page's visibility, just at the paragraph level. No partial/temporary
reveal exists or is planned; a DM who wants it hidden again types `/secret` around it.

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

### 7.7 Templates and typed fields (P3, first item)

**The schema was already there and unused.** `apps/server/migrations/0001_init.sql`
already had `templates` and `fields` tables, and `nodes.template_id` as an inert
passthrough nobody validated or acted on. This phase is almost entirely new
services/routes/schema/UI on top of tables that sat there since P0 — the only new
migration is `0007_fields_unique_key.sql`, a single `UNIQUE(node_id, key)` index that
makes "instantiate a template field if the node doesn't already have one under that key"
race-safe via `ON CONFLICT DO NOTHING` instead of check-then-insert.

**A Template is field *definitions*; `fields` rows are field *values*.** Assigning a
template to a node (`nodes.template_id`, set through the same `updateNode`/`createNode`
path as everything else — no separate endpoint) copies each definition the node doesn't
already have, by key, as a blank/default `fields` row
(`services/templates.ts::assignTemplateFields`). This is deliberately **one-way and
non-retroactive**: editing a template's `field_schema` later never reaches back and
touches nodes that already instantiated fields from it — that would silently mutate
content nobody asked to change. A DM who wants new fields backfilled onto existing pages
uses the explicit "Re-apply template" action (`POST /nodes/:nodeId/apply-template`, also
the `apply_template` MCP tool) — the same instantiation call, just invoked by hand. The
node/template relationship is intentionally loose after that point: a node can diverge
from its template freely (extra ad hoc fields, edited values, even a field with the same
key as a template def that's since changed type — the row is the node's own).

**Two things forced by the existing schema, not by choice:**
- `fields` has no `label` or `created_by` column. A field's display `label` and (for
  `select`) its `options` are resolved at **read time** by looking up the node's
  `template_id` → the template's `field_schema` → matching by `key`
  (`services/fields.ts::defsByKey`/`toDto`). An ad hoc field, or a field whose template
  was since deleted or edited to drop that key, just shows its own `key` as typed — this
  is why a field can silently lose its nice label/options if the template disappears;
  that's accepted, not a bug (see the manual verification note below).
- Field visibility is a 3-value subset — `public | members | dm`, no `private` — since
  there's no creator column to key a "private to whoever made it" rule off of. Filtered
  with `readableLevels(role).filter(l => l !== "private")`, not the `visibilitySqlFor()`
  helper nodes/posts use.

**`select` can only ever come from a template.** Its `options` list lives only in the
template's `field_schema`, never on the `fields` row itself, so an ad hoc field (no
template backing it) has nowhere to store options — `createFieldInputSchema` excludes
`select` from the type enum accordingly, both server-side and in the "+ Add a field"
form's type list.

**Client: no Edit/Save toggle, same house style as everything else in this app.** The
Fields panel (`NodeView.tsx`'s `FieldsPanel`, in the right rail above the existing
Kind/Visibility/Updated block) autosaves per field — `onBlur` for text/longtext/number,
`onChange` for checkbox/select/date/link — with a small gold dot marking a `dm`-visibility
field, reusing the same gold treatment `Sidebar.tsx` already uses for a DM-only page. The
Templates editor itself (DM Menu → Templates) is the one exception with an explicit Save
button, deliberately: a template's field list is edited as one whole document (add/
reorder/remove several fields, then commit), the same reasoning that makes ACL's
individual grants separate rows but a template's field schema a single
`PATCH`/`updateTemplate` call.

**Verified by hand in the browser, beyond the smoke/MCP suites**: built an "NPC" template
(text/select/checkbox/date/section fields) from the DM Menu, assigned it to a node via
"⋯" → Template…, confirmed the Fields panel populated in schema order with working
per-type inputs (including a `select`'s options resolving correctly), toggled "View as a
player" and confirmed a `dm`-visibility field disappeared while `members` ones stayed,
and confirmed "Re-apply template" only appears once a template is actually assigned. Also
observed firsthand the read-time label/options resolution's consequence noted above: a
node whose template had since been deleted (by an earlier smoke-test run against the same
data directory) showed its fields with bare keys as labels and an empty `select` options
list — exactly as designed, not a regression.

### 7.8 Maps (P4)

Unlike P3, there was **no pre-built schema** to wire up — `nodes.kind` already reserved
`"map"` as a valid enum value, but nothing else existed: no `maps`/`map_markers` tables,
no client-side dispatch by `kind` at all, no image-processing dependency, no map library.
This grew into a large enough feature that it's split into sub-phases (P4.1–P4.6); **only
P4.1 is built**. See the approved plan at the time (`purrfect-growing-catmull.md` in
`.claude/plans/`, if still present) for the full design across all sub-phases, or
`docs/PLAN.md` §8's P4 entry for the condensed version.

**Reference material, used for architecture only** — Kanka is Commons Clause (no code
copied), ttrpg-maps and DungeonBoard are MIT but still only read for ideas:
`C:\Users\Wizard\Documents\DNDAPPREF\kanka` (tiling pipeline shape, marker
null-coalesce-to-linked-entity inheritance, `maps`/`map_layers`/`map_markers` migration
history), `ttrpg-maps` (matthttam — zoom-gated layer visibility, marker shapes, pixel-space
coordinates), `DungeonBoard` (McAJBen — the "paint to reveal" fog mechanic P4.4 will be
modeled on). `loreweave` and `ttrpg-tools-time`, two other reference repos added the same
session, were checked and are **not map-related** — good material for P5 instead.

**P4.1, built**: a `kind="map"` node gets at most one `maps` row (source image + pixel
bounds) via `migrations/0008_maps.sql`, plus any number of `map_markers` rows. Markers are
**one typed table with a `shape` discriminator** (`pin | label | circle | polygon | path |
token` — only `pin`/`label`/`circle` have UI in P4.1, the rest are reserved for
P4.3/P4.5) rather than a table per shape, matching how `fields` already covers every field
type in one table. A marker's `target_node_id` makes it link to any node; if its own
`label`/`icon` are unset, they resolve from that node's title/icon **at read time**
(`services/maps.ts::toMarkerDto` / `targetNodeFor`) — the same "resolve from the source,
don't duplicate" pattern `services/fields.ts` already uses for template-seeded labels.
**Nested maps need no special code at all**: a marker linking to another `kind="map"` node
just navigates there via the existing `navigate()`, same as any other link — landing on
that node mounts `MapView` again.

**New server dependency: `sharp`.** Used today only for `services/assets.ts`'s
`ensureAssetDimensions()` — reads the file, calls `sharp(path).metadata()`, backfills
`assets.width`/`height` (both nullable, lazily populated; not computed at upload time, so
ordinary editor-image uploads never pay this cost). P4.2 will extend `sharp`'s usage to
actual tile generation.

**New client dependencies: `leaflet` + `react-leaflet@4.2.1`** (pinned below the current
`5.x`, which requires React 19 — this app is still on React 18). `MapView.tsx` renders
`<MapContainer crs={L.CRS.Simple} bounds={[[0,0],[map.height,map.width]]}>` — pixel-space,
y-down, the convention both Kanka and LegendKeeper use — with an `<ImageOverlay>` (P4.2
swaps this for a `<TileLayer>` once tiling exists). Markers use a hand-built `L.divIcon`
(`iconFor()` in `MapView.tsx`) rather than Leaflet's stock marker image, deliberately —
Leaflet's default icon assets don't resolve correctly under Vite without extra config, and
a `divIcon` showing the node's actual emoji icon is more useful here anyway.

**Client wiring, since no kind-dispatch mechanism existed before this**: `NodeView.tsx`
now has the first-ever `node.kind === "map"` branch (mounting `MapView` instead of
`<Editor>`, inside a fixed `h-[75vh]` wrapper — Leaflet needs its container to resolve to
a real pixel height, and the surrounding layout is `overflow-y-auto`/flex in a way that
doesn't hand a percentage-height child a real size otherwise; **`MapView`'s own root div
must be `h-full`, not `flex-1`**, since its immediate parent isn't a flex container — this
tripped verification once already, symptom was a real `<div class="leaflet-container">`
in the DOM with `height: 0`, silently swallowing every click). There was previously no UI
to create a node with `kind !== "document"` at all (the server always accepted `kind` in
`createNodeInputSchema`, the client just never sent it) — added a targeted **"+ New map"**
button in `Sidebar.tsx` and **"Add a map inside"** in `NodeView.tsx`'s "⋯" menu, both
calling `api.createNode(worldId, { title, parentId, kind: "map" })`, rather than building
a generic kind-picker for kinds nothing renders yet (board/timeline/calendar).

**Verified**: `npm run smoke`'s `== maps ==` section (upload → set image → dimension
backfill → cross-world asset rejection → marker CRUD → inheritance → override →
DM-visibility filtering → edit-permission gating); `npm run test:mcp`'s `== maps ==`
section (`place_marker` → `get_map` shows it → `update_marker` → `delete_marker`); by hand
in the browser — uploaded a real image via a synthesized `File`/`DataTransfer` (this
session's browser automation couldn't drive a real OS file picker), dropped two pins,
linked one to an existing page and confirmed it inherited that page's title with no
override set, clicked "Open page →" and confirmed real navigation, then set a marker to
`dm` visibility and confirmed it disappeared from `GET .../map/markers` under "View as a
player" while a `members` marker stayed visible.

**P4.2, tiling, built and verified**: `services/maps.ts::startTiling()` runs
`sharp(sourcePath).webp({...}).tile({layout:"google", depth:"onetile", ...}).toFile(...)`
in the background (fire-and-forget, not awaited by the route handler — same
no-queue precedent as `index.ts`'s session-purge interval) whenever `setMapImage` sees
an image over `TILING_THRESHOLD_PX` (2000px on either axis). **Two things worth knowing
if you touch this again:**
1. **`sharp`'s tile-layout options must be set *before* `.tile()` is called in the
   chain**, not after — `sharp(buf).tile({...}).webp(...)` silently produces a single
   whole-image file instead of a tile directory, no error thrown. Discovered by testing
   directly against a synthetic image; `sharp(buf).webp(...).tile({...})` is the order
   that actually works. If tiling ever silently stops producing a directory, check this
   first.
2. **Missing-static-file requests used to 200 with the SPA shell instead of 404ing** —
   `index.ts`'s `setNotFoundHandler` only special-cased `/api/` paths as JSON 404 and
   sent `index.html` for literally everything else, including a genuinely-missing
   `/tiles/...` or `/media/...` path. Harmless for Leaflet (a broken `<img>` either way)
   but a real bug for anything that checks content-type or just `.ok` — fixed by also
   404-ing `/media/` and `/tiles/` in that handler. Caught by hand in the browser, not
   by any automated test — a case for occasionally poking at edge-of-viewport tile
   requests, not just the happy path, in future map work.

Verified: `smoke.mjs`'s tiling checks (upload a large synthetic image, confirm the PUT
response returns before tiling finishes, poll until `tilingStatus` reaches `ready`,
confirm `maxZoom` replaced the untiled default, fetch a real tile and confirm it's
genuinely servable, confirm replacing a tiled map with a small image resets
`tilingStatus` back to `none`); by hand in the browser (canvas-drawn 2200×2100 test
image, watched the network log show `ImageOverlay` swap to a live `TileLayer` with no
reload, confirmed via `img.leaflet-tile` elements in the DOM).

**P4.3, region/zone polygons, built and verified.** The `polygon` and `path` marker
shapes that 0008 reserved (and whose `points` column had no validation at all until
now) are now the full feature: labeled, colored polygons that split up a map —
borders, "off-limits" areas, named zones — plus an open `path` (polyline) for routes.
What actually changed:
- **`packages/schema` now owns the `points` format.** `parseMarkerPoints()` (strict:
  `"x,y x,y ..."`, whitespace-separated, one integer/decimal pair per vertex, no
  exponents, a 2,000-vertex cap) and `formatMarkerPoints()` (canonical single-space,
  2-decimal rounding) are the one definition of well-formedness, so the draw UI, the
  REST API, and the MCP server cannot drift apart. `points` on the create/update input
  schemas is `refine`d against it; a malformed string 400s at the route boundary
  instead of being stored and never being fixable.
- **`services/maps.ts` enforces shape-specific semantics** (it knows `shape`; the
  schema package doesn't): a `polygon` needs ≥ 3 vertices, a `path` ≥ 2, and no other
  shape may carry points at all. Points are canonicalized on write (the stored bytes
  are always `formatMarkerPoints(parseMarkerPoints(input))`), so a producer sending
  `"10,20  30,40"` with a double space stores the same string the draw UI would.
  PATCH with no `points` leaves the shape untouched; a `polygon`'s points can never be
  cleared — delete the marker (a "region with no vertices" is a contradiction the UI
  exposes no path to).
- **`MapView.tsx` gained a draw mode.** The toolbar's polygon/path buttons start a
  draft instead of a click-to-place: click adds a vertex, double-click (or the Done
  button) finishes, Escape or Cancel aborts, and the live preview is a translucent
  `Polygon`/`Polyline` with vertex circles and a close button — pan/zoom stay live
  while drawing (Kanka-style free drawing; the map's `dblclick` zoom is suspended
  only while a draft is active, because Leaflet fires two clicks before every
  dblclick and the draft handler must own the vertex list to strip that phantom pair).
  New shapes render as a filled/clickable `Polygon` (or stroked `Polyline`) with a
  draggable label anchor at the marker's own x/y, and the marker inspector gained a
  **Redraw shape** button that re-enters draw mode pre-targeted at the existing
  marker (the draft commit PATCHes its `points` instead of creating a new marker).
  Polygon/path markers are also the only markers that get the `color` field a real UI
  for (pins keep their fixed palette; regions need a color of their own).
- **MCP:** `place_marker`/`update_marker` accept `points` (documented as polygon/path
  only), `get_map` reports a vertex count per shape marker, and the
  `integration-test.mjs` `== maps ==` section exercises the full place→read→redraw→
  reject-too-few-vertices→delete flow.
- **`smoke.mjs` `== maps ==`** gained the P4.3 block: create/canonicalize, vertex-minimum
  400s for both shapes, non-shape-with-points rejection, malformed-points rejection,
  redraw via PATCH, and the §6.5 DM-leak assertion — a `dm`-visibility region must be
  invisible in the player's marker list *and* 404 on a direct PATCH even for a player
  who holds edit rights on the map (the check re-grants edit rights for its duration
  on purpose — without them the 403 from `requireMapNode` masks the
  marker-visibility rule, which is the exact leak §6.5 exists to catch).

Verified: 12 new unit tests on the parser (`apps/server/src/lib/marker-points.test.ts`
— `npm test` is now 31), the full `== maps ==` smoke section (including the new DM-leak
assertion) against a fresh server, `test:mcp` end-to-end over stdio, `typecheck` clean
on all three packages, and `build` green. Not yet covered: drawing in a real browser
(the automated checks hit the API and MCP, not the Leaflet interaction layer) — the
draw-mode state machine is small and typechecked, but the first human draw is the real
acceptance test, especially double-click-to-finish at high zoom.

**P4.3's provenance is unusual and worth recording**: this sub-phase was implemented
independently by the owner's own locally-hosted model (Hermes 3.8 27B, a quantized
GGUF, run through `llama-server`), producing a standalone patch file rather than a
live branch. It was reviewed hunk-by-hunk (not merged on trust), then verified for
real: applied cleanly with `git apply` onto the pushed P4.1/P4.2 code, `npm run
typecheck` clean across all three packages, `npm test` (31/31 including its own new
`marker-points.test.ts`), and the full `npm run smoke` suite green against a live
instance on an isolated port/data dir. It correctly scoped itself to zero schema/route
changes (reusing what P4.1's migration already reserved), built on top of the
`requireOwnMarker` visibility fix from this same session rather than reverting it, and
independently reproduced the §6.5 DM-leak-on-mutation test convention for its own new
surface. Genuinely mergeable quality — noted here so a future session doesn't assume
every line was written by whichever agent's session log claims the phase.

**A real bug found afterward, in P4.1/P4.2's own code, not the P4.3 patch**: the first
time a real (non-synthetic) image over 2000px was tiled and opened in an actual
browser, the map rendered as a wall of 404s / effectively blank. Root cause was two
compounding issues in `MapView.tsx`, both invisible until that point because
`ImageOverlay` (P4.1's untiled path) doesn't care about either:
1. `L.CRS.Simple`'s default `transformation` negates y (`point.y = -lat`), but this
   app's pixel space is y-down (row 0 at the top). Every row below the top edge landed
   in *negative* internal point-space.
2. `L.CRS.Simple`'s `scale(zoom) = 2^zoom` means a raw pixel coordinate only equals its
   Leaflet point-space coordinate at *one* zoom — the deepest/native tiled zoom, not
   zoom 0 — but bounds and every marker position were using raw pixel numbers directly
   at every zoom.
Both combined to make `TileLayer` request tile rows/columns nowhere near what `sharp`
actually generated (e.g. `/tiles/<id>/0/5/-9.webp` when zoom 0 only ever has a single
`0/0/0.webp`). Fixed with a custom `PIXEL_CRS` (`new L.Transformation(1, 0, 1, 0)`, no
negation) plus a `scaleFor(map)` factor (`2^maxZoom` once tiled, `1` before) threaded
through every pixel↔latlng conversion point in `MapView.tsx` — bounds, pin/circle/label
markers, drag handlers, and the P4.3 draw tool's click/vertex handling. Verified by
actually loading a real 3072×4096 photo through the tiling pipeline in a browser and
confirming the tile requests land on real, servable files — the smoke suite's tiling
check only confirms a tile file exists on disk, not which coordinates a real Leaflet
instance requests, so this class of bug won't be caught by `npm run smoke` alone; a
manual browser pass with a real, non-synthetic large image is the only thing that
actually exercises this path.

**A missing feature, also found while chasing the above**: there was no way to replace
a map's source image once one was set — the upload control only rendered in the
"no image yet" branch of `MapView.tsx`. Added a **🖼 Replace image** button to the
always-visible map toolbar (reuses the existing `setMapImage` upload flow verbatim);
an upload error now surfaces as a small toast near the toolbar instead of only in the
empty-map state.

**A second, more serious bug found 2026-08-24 — "the map still looks bad" was a real
tile-coordinate transposition, not a vague quibble.** The owner said this after the
CRS fix above, with no further detail; rather than wait on a screenshot, the map
pipeline was re-verified directly: uploaded a purpose-built 3000×2200 test image (four
solid, distinctly-colored quadrants, split at (1500, 1100)) through the real tiling
pipeline, then fetched the specific tile files a live `<TileLayer>` would request for
several known, off-diagonal pixel coordinates and decoded their actual pixel color with
`sharp`. Root cause: `sharp`'s `tile({layout:"google"})` writes this pyramid to disk as
`{z}/{row}/{col}.webp` (confirmed by enumerating the real output directories — the
"google layout" name does not imply this), while `MapView.tsx`'s `<TileLayer>` requested
the more-familiar-looking `{z}/{x}/{y}.webp}`, where Leaflet's own `{x}`/`{y}` are
column/row respectively (confirmed from this file's own `pixelToLatLng`: `lat = y/scale`,
`lng = x/scale`, and Leaflet projects `latlng` to `point.x = lng, point.y = lat`). Column
landed in the row slot and vice versa. For any image where width and height need a
different number of 256px tiles — i.e. nearly every real map, since a perfectly square
map is a coincidence — this meant every non-diagonal tile was either:
- **silently served from the wrong coordinates** (row and column swapped), whenever
  both index values happened to fit inside the narrower axis's directory count, or
- **404 outright**, once the wider axis's index exceeded the narrower axis's count,
  leaving a whole strip of the map blank.

Fixed by swapping the URL template to `{z}/{y}/{x}.webp`, and — so this can't silently
drift back — the template itself was pulled out of `MapView.tsx` into a single shared
export, `mapTileUrlTemplate()` in `packages/schema`, which both the client and a new
`smoke.mjs` regression import and use identically (see below). This was invisible to
every check that had been run against it before now:
- **The existing `smoke.mjs` tiling fixture** (`continent.png`, 2200×2100) is
  coincidentally near-square — both axes round up to exactly 9 tiles at native
  resolution — so there is no index value that overflows one axis but not the other, and
  it is flat-colored, so a transposed tile is pixel-identical to the correct one. This
  fixture cannot detect this bug no matter how it's asserted against; a new,
  deliberately non-square, four-quadrant fixture was added specifically to close that
  gap (below).
- **The manual browser verification that fixed the CRS bug above** used a real
  3072×4096 photo, but only checked "do tile requests 404" — never "is each tile's
  actual content correct for its position." A photo's content can look locally
  plausible even scrambled, especially glanced at rather than compared pixel-by-pixel
  against known coordinates.

**Verified**: `npm run typecheck` clean, `npm test` (31/31), the full `npm run smoke`
suite (which now includes a new `== map tiling: tile coordinates are not transposed ==`
section — a non-square, four-quadrant test image, fetching the exact tile a real
`<TileLayer>` would request for several off-diagonal pixel coordinates via the shared
`mapTileUrlTemplate()`, and asserting the decoded pixel color is correct, not
transposed). Confirmed the new regression actually catches this class of bug by
temporarily reverting the template and re-running the suite (3 of the 4 new checks
failed, in exactly the predicted way — two wrong colors and one 404 — then passed clean
again once reverted). Also verified end-to-end in a live browser session: created a
world, uploaded the same test image through the real HTTP upload flow, waited for
tiling, and confirmed via direct authenticated fetches (the Browser pane's screenshot
compositing was unavailable in this environment, so pixel-level HTTP verification stood
in for a visual check) that the specific tiles a real `<TileLayer>` would request now
decode to the correct quadrant color at both a previously-wrong-content coordinate and a
previously-404 coordinate. `test:mcp` also re-run clean (57/57) since it exercises
`get_map`/marker tools over the same HTTP surface.

**Map editor UI pass, 2026-08-25 — region/path vertex editing, and a real Leaflet
theming gap.** A round of direct owner feedback on the map editor, addressed in one
pass:

- **Editing an existing region/path used to mean redrawing it from scratch.** There was
  no way to nudge one vertex or add a single point to an otherwise-correct shape — only
  the inspector's "Redraw shape" button, which restarts the whole draft. Selecting a
  polygon/path marker now shows a small draggable dot on every vertex (drag to move it)
  and a dashed highlight over every line segment (click anywhere on one to insert a new
  vertex right there, split between that segment's two endpoints). Both write straight
  through `update_marker`'s `points`. Deliberately not built: dragging the whole shape
  by its filled body (translating every vertex at once) — that needs a small Leaflet
  plugin (`Leaflet.Path.Drag`) this project doesn't depend on, and per-vertex dragging
  plus the existing draggable label anchor already cover repositioning.
- **`<MapContainer>`'s `minZoom`/`maxZoom`/`maxBounds`/`maxBoundsViscosity` only apply
  once, at the instant react-leaflet constructs the underlying `L.Map`** — its own
  source memoizes that construction with an empty `useCallback` dependency array, so
  passing a new value as a prop later has no effect on an already-open map (only a
  genuine remount does, i.e. navigating to a *different* map node, since this map's
  `key={node.id}`). This is why raising the untiled zoom ceiling didn't do anything for
  a map that was already open when the owner tested it — the code was correct, but a
  live map instance never saw it. Fixed generally, not just for this one case: a small
  `<MapOptionsSync>` child (inside `<MapContainer>`, using `useMap()`) applies these
  values imperatively via Leaflet's own setters (`map.setMinZoom`/`setMaxZoom`/
  `setMaxBounds`, and a direct `map.options.maxBoundsViscosity =` assignment since
  Leaflet has no setter for that one), so any future change to these takes effect
  immediately regardless of when it happens. The zoom ceiling for an untiled map (one
  small enough to skip the tiling pipeline) is also raised substantially
  (`maxZoom + 6` instead of `+ 2`) — it gets soft past native resolution, same as
  zooming into any raster image, which is expected and still strictly better than a
  hard wall.
- **`maxBounds` was the image's exact pixel edges**, so panning toward a corner had
  nowhere left to go once you reached it — the empty space beyond (unavoidable
  whenever the viewport's aspect ratio doesn't exactly match the image's) had nothing
  to show but bare `.leaflet-container` background, which read as a stray dark bar.
  `maxBounds` is now the initial-fit `bounds` padded by half a screen's worth on every
  side (`L.latLngBounds(bounds).pad(0.5)`), with `maxBoundsViscosity={0.8}` for soft
  resistance near that edge instead of a hard stop — a corner or edge marker can now sit
  comfortably in the middle of the view. The *initial* view (`bounds` itself) is
  unchanged, so a map still opens showing the whole image.
- **Leaflet's own stylesheet ships light-mode chrome** — white zoom buttons, a white
  attribution strip, a light `.leaflet-container` fallback background — none of it ever
  themed against this app's dark UI, which is almost certainly what read as "so much
  white background." `.leaflet-container`, `.leaflet-bar`, and
  `.leaflet-control-attribution` are now overridden in `styles.css` to match the app's
  palette. Two of these needed `!important`: `.leaflet-container`'s background, because
  MapView.tsx's own Tailwind class and this stylesheet rule have equal specificity and
  whichever loads later in the bundle wins that tie (not something to depend on), and
  `.leaflet-bar a`'s background, one of Leaflet's own higher-specificity rules.
- **The marker inspector's icon field was a blank text input with no guidance.**
  Swapped for the existing `IconPicker` component (already used for page icons) — a
  grid of presets plus a custom-paste fallback, so there's something to pick from
  instead of needing to already know an emoji to type.
- **Color was hex-only, no picker.** Added a native `<input type="color">` next to the
  hex field (the browser's own picker already provides a saturation/hue spectrum,
  no reason to hand-roll one) plus a small localStorage-backed favorites system — save
  the current color under a name, click a saved swatch to reapply it, right-click to
  remove one. Same "personal preference, not campaign content, no server round-trip"
  reasoning as `usePinned`.
- **Ctrl/Cmd+Z while drawing** undoes the last placed vertex, so a mis-click while
  drawing a region doesn't mean starting over.
- **"+ Add a page inside {title}" → "+ Add a page under {title}"**, and the metadata
  sidebar's **"Pages inside" → "Children"** (with the matching section heading changed
  to "Child pages") — wording requested directly, applied everywhere both phrases
  appeared (Sidebar.tsx, NodeView.tsx, ShareView.tsx). The "+ New" chooser's **"Lore"
  tile is now "Document"**, for the same reason.

Verified: `npm run typecheck` and `npm run build` clean; drag/click interaction itself
confirmed working by the owner directly (this environment's Browser pane cannot
reliably drive Leaflet drag/click, per §8.5) after the fix landed.

**Party/army tokens (P4.5), 2026-08-25.** A `token`-shaped marker with a
self-referential `parent_marker_id` — the schema already reserved this column in P4.1,
unused until now. A party token can have squad tokens grouped under it, arbitrarily
deep (a squad can itself have a further split grouped under it).

- **Group visibility is dominant**, matching Kanka's own `MapGroup` model: a marker's
  *effective* visibility is the most restrictive value across itself and its entire
  parent chain, not just its own `visibility` column. Hiding "the party" (setting it to
  `dm`) hides every squad grouped under it in both `listMarkers()` (the map's marker
  list) and `requireOwnMarker()` (direct-by-id access, so a player with edit rights on
  the map still can't read or destroy a group-hidden marker just by knowing its id) —
  the same "new surface, same treatment" rule §6.5 asks for. This can't be expressed as
  a flat SQL `WHERE` the way a plain column comparison can (it needs the whole map's
  parent chains), so `listMarkers()` fetches every marker on the already-visibility-
  gated map and filters before any row reaches a DTO or leaves the function — still
  "never returned," just computed in JS instead of the SQL text. See `effectiveVisibility()`
  in `services/maps.ts`.
- **Cycle prevention.** Setting a token's `parent_marker_id` to itself, or to one of its
  own descendants, is rejected (`wouldCycle()`) — checked server-side (the real
  guarantee) and the client's "Group" dropdown also excludes both, so the UI never
  offers an option it already knows is invalid.
- **A new `radius` column** (migration `0009`) for `circle` markers, added the same
  session — there was no stored size at all before this; the client hardcoded
  `radius={10}` **screen pixels** with nothing to change it, which is the literal answer
  to "why can't I resize it." Stored in the same native-image pixel space as x/y/points,
  and rendered via Leaflet's `Circle` (not `CircleMarker`) so it scales with zoom like a
  region's vertices already do, instead of staying a constant on-screen size.
- **A real, pre-existing bug found while wiring `parent_marker_id` into the MCP
  server**: `update_marker`'s handler spread its snake_case arguments straight into the
  (camelCase) `UpdateMarkerInput` with no translation — `async ({ marker_id, ...input })
  => client.updateMarker(marker_id, input)`. This happened to work for every field
  because every other one is a single word with no snake/camel difference to lose
  (`label`, `icon`, `color`, `radius`, `points`, `members`, `visibility`).
  `target_node_id` is not: sent this way, it became an unrecognized key that the
  server's `updateMarkerInputSchema.parse()` silently drops, so **a `target_node_id`
  update sent through `update_marker` has never actually taken effect**, since that
  tool existed. Fixed by mapping fields explicitly, matching the pattern
  `place_marker` already used correctly. Regression: `apps/mcp/scripts/
  integration-test.mjs` places a marker with no target, links it via `update_marker`,
  and asserts `get_map`'s output actually shows the link — not just a non-error
  response, which is exactly the kind of false-positive this bug would have hidden
  behind.
- Inspector gains a "Group (parent token)" dropdown and a "Who's in this group"
  freeform text field, both token-only. `get_map`'s MCP output now shows a marker's
  group (`(group: [parentId])`) alongside its existing target/visibility annotations.

Verified: `npm run typecheck`, `npm run build`, 31 unit tests, the full `npm run smoke`
suite (14 new checks: grouping at creation, self-parent and cycle rejection, explicit
group/ungroup round-trips, the group-visibility-dominance leak check from both the list
and direct-PATCH surfaces, and the delete-a-parent-ungroups-children cascade), and
`npm run test:mcp` (8 new checks, including the `target_node_id` regression above) —
all against isolated servers, never the owner's own live dev instance.

**Open, unconfirmed as of this writing**: the owner reported the sidebar's per-row "⋯"
menu and the top-bar "Page actions" ⋯ button becoming unresponsive, and right-click not
opening a context menu, while on/around the map page — in their own browser, after
several rapid rebuilds landed under an already-open tab. It was **not reproduced**
in this session's automated browser testing (the "Page actions" dropdown was confirmed
to open via a direct script-driven click; an earlier attempt that looked like a hang was
actually reading the DOM before React's render had committed, a false alarm from the test
method, not the app). Leading theory is a stale tab holding an old JS bundle across a
`vite build` that changed the asset hash mid-session — ask the owner to hard-refresh
(Ctrl+Shift+R) before investigating further, and get exact repro steps (which button,
which page, immediately before vs. after) if it still reproduces. Do not assume this is
fixed; it is unconfirmed either way.

### 7.9 Sidebar right-click menu, the "+ New" chooser, and pinned pages

Three additions the owner asked for after comparing this app to a LegendKeeper trial:

- **Sidebar rows now have their own action menu** (`Sidebar.tsx`'s `menuForId` state),
  reachable by right-click (`onContextMenu`) or the row's own hover-revealed "⋯"
  button — previously a sidebar row had *no* actions at all beyond click-to-navigate,
  drag-to-reorder, and the "+" child-page shortcut; every rename/archive/etc. required
  first opening the page and using its own header menu. The menu shows "Add a page
  inside…", "Rename" (inline — turns the row's title into a text input, no popup, same
  house style as the title field everywhere else), "Pin"/"Unpin", and "Archive". A real
  bug caught during manual verification: the overlay `<div>` that's supposed to close
  the menu on an outside click was written with `onClick={(e) => e.stopPropagation()}`
  instead of also calling `setMenuForId(null)` — it silently ate the click instead of
  closing anything, so the menu stayed open across unrelated interactions. Fixed;
  the working pattern (see `dmMenuOpen`'s own overlay a few lines below) is
  `onClick={() => setX(false)}`, not just `stopPropagation`.
- **No per-row `canEdit`.** Unlike the page-detail view (which has full `NodeDetail`
  including `canEdit`), a sidebar row only has `NodeSummary`. Rather than fetch full
  detail per row just to gate a menu item, Rename/Archive are shown to everyone and the
  server is the real gate (matching how every other mutation in this app already works)
  — a rejected PATCH/DELETE just silently reverts the optimistic UI (no toast system
  exists yet to show a real error for this rare case).
- **"+ New" replaces the separate "+ New top-level page"/"+ New map" buttons** with one
  chooser (`CreateChooser.tsx`) — tiles for Lore/Map (Board/Timeline shown disabled,
  "Soon" — same "declare the shape before it's built" idea as the MCP server's
  placeholder tools) plus, if the world has any, a list of saved templates to start
  from. Creating from a template is `api.createNode(worldId, {..., templateId})` —
  already fully supported server-side since P3 (`createNodeInputSchema` always accepted
  `templateId`; the client just never had a UI path to send one until now), so this
  needed zero server changes.
- **Pinned pages** (`usePinned()` in `App.tsx`, `PinnedStrip.tsx`) — a manually toggled
  set of node ids, persisted to `localStorage` keyed by world id, same reasoning as
  `Sidebar.tsx`'s own expand/collapse state: a personal view preference, not campaign
  content, so it needs no server round-trip and no schema. Rendered as a full-width
  strip above the sidebar+content row (App.tsx's top-level layout gained a `flex-col`
  wrapper for this — `Sidebar`'s own root had to change from `h-screen` to `h-full` to
  fit inside it correctly). Toggled from both the sidebar row menu and the page's own
  "⋯" menu, so pinning is reachable from wherever you already are.

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

**`/media/` is served with no authorization check, deliberately — this is a capability
URL, not an oversight.** The 2026-08-24 audit (`docs/AUDIT-2026-08-24.md`, finding 1.5)
flagged this and found the sibling `/tiles/` prefix genuinely unauthorized (fixed, see
below); `/media/` was evaluated the same way and kept as-is, for a reason specific to it:
anonymous share links (`ShareView.tsx`, §7.5) render a node's body with **no session and
no token at all**, and that body can contain `<img src="/media/...">` from a pasted or
dropped image. Gating `/media/` behind world membership would break every image on every
shared page. The mitigating facts are that asset filenames are sha256 content hashes
(unguessable — nothing about the path reveals which world or node an image belongs to)
and assets have no single owning node to check visibility against anyway (one image can
be reused across many node bodies). If this ever needs to be tightened — e.g. signing
asset URLs per share-scope, so a shared page's images work but a bare `/media/<hash>`
guess does not — that is real, unscheduled work, not a one-line fix.

`/tiles/` got the opposite answer: it is keyed by the map's own short **node id**, which
appears in the URL bar, every tree response, and every share-link payload — not a
capability URL by any reasonable definition. `index.ts` now runs `viewerForNode` +
`requireVisibleNode` for the map node in an `onRequest` hook before `@fastify/static`
serves anything under that prefix, so a map that goes `dm`-only stops serving its tiles
to a player who saw the id while it was open.

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

In one P4 session, `computer{action:"screenshot"}` also returned a blank frame
repeatedly even though `read_page`/`get_page_text` confirmed real content was rendered —
`getBoundingClientRect()` on a real element showed a genuine 0-height viewport at the
time. Re-verify with `read_page`/`get_page_text`/`javascript_tool` (DOM-level) rather than
trusting a screenshot alone if a page looks suspiciously blank; only trust "the app is
actually broken" once a DOM query itself confirms zero/wrong layout, not just an odd
screenshot. Uploading a real file also isn't possible through this browser pane (no OS
file picker) — simulate it with a synthesized `File`/`DataTransfer` dispatched onto the
hidden `<input type="file">`, same as `MapView.tsx`'s upload control uses.

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

Registered: `list_worlds`, `get_tree`, `get_subtree`, `find_nodes`, `get_node`,
`list_templates`, `list_unresolved_links`, `create_node`, `update_node`, `move_node`,
`archive_node`, `create_post`, `update_post`, `set_node_template`, `set_field`,
`delete_field`, `apply_template` (see §7.7), `get_map`, `place_marker`, `update_marker`,
`delete_marker` (see §7.8). `get_subtree` renders just one page's descendant hierarchy as
an indented outline (client-side filter over the same `GET .../tree` payload `get_tree`
already uses — no new server route), for "find the family/faction/region node, then see
what's nested under it" without pulling in the whole world. Plus `add_event` and
`advance_calendar`, which report that they are not built yet — declared on purpose so the
eventual shape is visible.

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
links, "view as a player," the DM Menu — see §7.2–§7.5). P3's templates and typed fields
are done too (see §7.7), and so are P4's first three sub-phases — maps with a source
image, background tiling, typed/inheriting markers, and labeled/colored region/zone
polygons (see §7.8). Next: P4.4 fog of war → P4.5 party/army tokens → P3's query views →
P5 calendars + timelines → P6 play mode → P7 hardening. See [PLAN.md](PLAN.md) §8.

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
| Template assignment is one-way, non-retroactive | Editing a template must never silently rewrite content on nodes that already instantiated fields from it. "Re-apply template" is the explicit, by-hand alternative. |
| Field label/options resolved at read time, not stored per-row | `fields` has no `label` column; storing it would let it drift from the template or need a migration to add. The cost: a deleted/edited template can leave a field showing its bare key. Accepted — see §7.7. |

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
