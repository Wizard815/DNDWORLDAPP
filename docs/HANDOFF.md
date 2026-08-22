# HANDOFF — read this first

Written 2026-08-21 for whoever (human or agent) picks this up next.

This document is the operating manual: what exists, why it is shaped this way, which
rules must not be broken, and what to build next. The other docs are:

| File | What it holds |
|---|---|
| [PLAN.md](PLAN.md) | The product plan and phase roadmap (P0–P7) |
| [kanka-mapping.md](kanka-mapping.md) | Kanka's model → ours, and the import plan for the real campaign |
| [legendkeeper-observations.md](legendkeeper-observations.md) | Field notes from inspecting a live LegendKeeper project |
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

**P0 is complete. P1.1 (API tokens) is complete.** Next up is P1.2, OpenAPI.

Verified by:
- `npm test` — 10 unit tests (fractional indexing, wiki-link parsing). All pass.
- `npm run smoke` — 45 end-to-end API checks against a running server. All pass.
- `npm run typecheck` — clean on both server and web.
- `npm run build` — client builds.
- Driven by hand in a browser: login → tree → page → posts → rendered wiki links.

### Working

- Users, cookie sessions, first-run setup screen, roles per world (owner/dm/player/guest)
- Worlds, memberships, add/remove member by email
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

### Not started

Maps, calendars, timelines, templates and typed fields, the query/view engine, boards,
statblocks, initiative, OpenAPI, the MCP server, the Kanka importer, realtime.

---

## 4. Codebase tour

```
apps/server/
  migrations/0001_init.sql   THE SCHEMA SOURCE OF TRUTH. Hand-written SQL.
  scripts/smoke.mjs          30-check end-to-end API test. Needs an empty data dir.
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
      policy.ts              ***THE AUTHORIZATION LAYER*** — read section 6
      viewer.ts              { userId, role } context type
    http/context.ts          requireUser / viewerForWorld / viewerForNode / startSession
    lib/
      id.ts                  shortId(8) for nodes, longId(20) for everything else
      sortkey.ts             Fractional indexing (+ tests)
      wikilinks.ts           [[link]] parsing, code-aware (+ tests)
      slug.ts                Slugify + per-world uniqueness
      errors.ts              HttpError + helpers
    services/                Business logic. Routes stay thin.
      nodes.ts               Tree, detail, create/update/move/archive, link reindexing
      posts.ts               Sections with visibility
      worlds.ts              Worlds, memberships, world creation (makes the root page)
      assets.ts              Content-addressed uploads
    routes/
      auth.ts                setup, login, logout, me, users
      worlds.ts              worlds, tree, search, members, node create, asset upload
      nodes.ts               node detail/update/move/archive, posts

apps/web/
  src/
    api.ts                   The ONLY place the client talks to the server
    App.tsx                  Shell: auth gate, queries, layout, Ctrl+K
    lib/nav.ts               Hand-rolled routing over /n/:nodeId
    lib/markdown.ts          Wiki-link rewriting → marked → DOMPurify
    components/
      Auth.tsx               Setup + login
      Sidebar.tsx            Tree, filter, drag-and-drop
      NodeView.tsx           Breadcrumb, title, editor, children, + Backlinks rail
      Posts.tsx              Sections with visibility badges
      QuickSwitcher.tsx      Ctrl+K

packages/schema/src/index.ts Zod schemas + DTO types shared by server and client.
                             The MCP server will import this too.
```

---

## 5. Data model

Read `apps/server/migrations/0001_init.sql` — it is short and commented. Summary:

```
users        id, email, name, password_hash, is_server_admin, created_at
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

Add `migrations/0002_whatever.sql`. Never edit an applied migration. Update
`src/db/types.ts` by hand in the same commit — nothing checks this for you.

---

## 7. API surface (all of it, today)

Base `/api/v1`. Auth is a `dwa_session` cookie. Errors are
`{ error: { code, message, details? } }`.

```
GET    /setup/status                        -> { needsSetup }
POST   /setup                               first run: owner + first world, signs in
POST   /auth/login                          { email, password }
POST   /auth/logout
GET    /auth/me
POST   /users                               server-admin only; creates an account

GET    /worlds                              worlds you are a member of (+ rootNodeId)
POST   /worlds                              { name }
GET    /worlds/:worldId/tree                the whole visible tree, one query
GET    /worlds/:worldId/search?q=&limit=    FTS5, ranked, with snippets
GET    /worlds/:worldId/unresolved-links    wiki links with no destination yet
POST   /worlds/:worldId/nodes               create a node
GET    /worlds/:worldId/members
POST   /worlds/:worldId/members             { email, role }  (owner/dm only)
DELETE /worlds/:worldId/members/:userId     (owner/dm only)
POST   /worlds/:worldId/assets              multipart, images only, 25 MB cap

GET    /nodes/:nodeId                       detail + breadcrumb + children + backlinks
PATCH  /nodes/:nodeId                       title, bodyMd, icon, visibility, templateId,
                                            isArchived
POST   /nodes/:nodeId/move                  { parentId, afterId?, beforeId? }
DELETE /nodes/:nodeId                       archives the subtree
GET    /nodes/:nodeId/posts
POST   /nodes/:nodeId/posts
PATCH  /posts/:postId
DELETE /posts/:postId

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

### 9.2 OpenAPI

Generate from the Zod schemas in `packages/schema`. The point is that the MCP server and
any future script have a contract, and that drift is visible.

### 9.3 The MCP server (`apps/mcp`)

A thin adapter over the HTTP API — **not** direct database access, or rule 6.2 rots.
stdio + streamable HTTP. Mirror the tool surface of the Kanka MCP the owner already uses
daily, so habits transfer:

```
find_nodes  get_node  create_node  update_node  move_node
create_post  update_post
link_nodes  create_relation
run_view  place_marker  add_event  advance_calendar
manage_permissions
```

Tools that target unbuilt features (`place_marker`, `advance_calendar`) should return a
clear "not implemented yet" rather than being omitted, so the shape is visible early.

### 9.4 The Kanka importer (`packages/kanka-import`)

Full plan in [kanka-mapping.md](kanka-mapping.md) §6. The order matters:
campaign → templates → entity shells → re-parent → bodies (HTML→markdown, then rewrite
Kanka `[entity:12345|Label]` mentions into `[[wikilinks]]` via the id map) → posts **with
their visibility** → attributes → tags → relations → calendars/events → images → report.

Two things to hold onto:
- Record `kanka_id` on every imported node so the import is idempotent (re-running
  updates rather than duplicating).
- **Treat the importer as the data model's exam.** If a real campaign with nested
  locations, hidden posts, custom attributes and a homebrew calendar round-trips cleanly,
  the model is sound. If it does not, better to learn that now than at P5.
- `TheOpenBin/07_DND/kanka_events.json` on the owner's machine is a ready-made calendar
  fixture; it already carries `lane` values that match LegendKeeper's timeline "groups".

### 9.4a The LegendKeeper importer (`packages/lk-import`)

Do this **alongside** the Kanka importer. The format is fully specified in
[legendkeeper-observations.md](legendkeeper-observations.md) §10, and the owner already
has exports of the world that holds the maps and timelines Kanka never had.

- `.lk` is gzipped JSON in the same schema as `.json` — gunzip, then one parser.
- An export is a subtree: a resource plus every descendant, with referenced calendars
  bundled and a sha256 `hash` for integrity.
- Document content is **Atlassian Document Format**. Use an existing ADF→markdown
  converter rather than writing a ProseMirror walker.
- `mention` nodes carry the target's id plus cached display text — map ids through the
  import id map and emit `[[Name|label]]` when they differ.
- `bodiedExtension` with `extensionKey: "block-secret"` is a GM-only inline block. It is
  the single most-used feature in the corpus (70 uses); make sure the importer preserves
  it rather than flattening it into visible prose. **This is a correctness issue, not a
  nicety — flattening it would leak the DM's secrets to players.**
- Media are CDN URLs; download and re-host or the import rots.

### 9.5 Then, in order

P2 remaining visibility work (per-node ACL, secret blocks inside a body, guest share
links, "view as player", invites) → P3 templates + query views → P4 maps → P5 calendars +
timelines → P6 play mode → P7 hardening. See [PLAN.md](PLAN.md) §8.

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
npm run typecheck      # tsc on server and web
docker compose up -d --build
```

`SESSION_SECRET` is required in production; generate with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

## 12. Open questions for the owner

1. **Guest access shape.** Is a guest a real account with a `guest` role, or an anonymous
   visitor on a share link? P0 assumes the former; P2 needs the latter too.
2. **Multiple worlds.** The schema supports many worlds per server, but the client shows
   only the first. Is a world switcher wanted, or is this a one-world install?
3. **Kanka cutover.** Is the plan to migrate off Kanka once, or to run both and sync for
   a while? The importer is idempotent either way, but a sync needs conflict rules.
4. **Obsidian.** Is a two-way Obsidian vault sync wanted, or is one-time import/export
   enough? Two-way is a much bigger commitment.
