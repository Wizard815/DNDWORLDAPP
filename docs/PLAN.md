# DNDWORLDAPP — Plan

Working name: **DNDWORLDAPP** (rename later).
Deploy target: **a Docker container on the homelab.** That is the product, not a later
packaging step.

> **Status, 2026-08-22 — P0, P1 and P2 are built and running. No importer is planned.**
>
> | | |
> |---|---|
> | **Done** | The spine (tree, pages, wiki links, DM notes, search, Docker) · scoped API tokens · OpenAPI generated from Zod · the MCP server · inline `:::secret` blocks · username/password accounts with a DM member panel, no email anywhere · per-node ACL overrides · anonymous share links · "view as player" · a single DM Menu in the sidebar |
> | **Next** | P3 templates and query views → P4 maps → P5 calendars and timelines → P6 play mode → P7 hardening |
>
> **No Kanka or LegendKeeper importer will be built.** The owner still runs the campaign in
> Kanka day to day and will move content over by hand through Kanka's MCP and ours as it
> is needed, rather than a one-shot bulk import. `docs/kanka-mapping.md` and
> `docs/legendkeeper-observations.md` stay as reference material — the schema and
> permission mapping in the former, and the export format in the latter, are still useful
> background — but neither describes work on the roadmap. If a bulk import is ever wanted
> after all, both formats are already fully specified there.
>
> [HANDOFF.md](HANDOFF.md) is the operating manual for picking this up — what exists,
> which rules must not be broken, and the environment gotchas. This file is the *why* and
> the roadmap.

## 1. What this is

A self-hosted worldbuilding / TTRPG campaign web app:

- **LegendKeeper's structure** — anything nests inside anything, wiki links, maps with
  nested pins, timelines, calendars — but self-hostable, and with a real API.
- **Kanka is the reference implementation.** Its schema, permission model and API shape
  are the source of truth for *how a self-hosted campaign app is built*. What we reject
  is exactly one thing: its rigid "every entity is one of N fixed types, filed into a
  type bucket" navigation.
- **Obsidian plugins are feature references only** — dataview, kanban, longform,
  statblocks, initiative tracker, leaflet, fantasy calendar. Read them for behaviour and
  algorithms (calendar math, Leaflet CRS, statblock schema), not architecture. They get
  merged into one app instead of ten plugins that do not know about each other.
- **First-class API + MCP.** LegendKeeper turns out to *have* a REST API — it is simply
  internal and undocumented (see [legendkeeper-observations.md](legendkeeper-observations.md)
  §9.1), and there is no MCP server. Ours is public, specified, and shipped with an MCP
  adapter. The tool surface deliberately echoes the Kanka MCP already in daily use, so
  existing habits transfer.

Non-goal: an Obsidian clone or a general note app. This is for building and *running* a
campaign, with a DM, players, and guests looking at the same world at different
permission levels.

## 2. The one idea the whole app rests on

**Everything is a Node. Every view is a query over Nodes.**

Kanka's model is `entities` plus one child table per type, and the UI navigates by type.
Ours keeps the useful half (a single entity spine, so links / tags / permissions / posts
are uniform) and throws away the other half:

- **Type is a facet, not a location.** A node's type comes from a **Template** it points
  at; "all Characters" is a saved query, not a folder you are forced to live in.
- **Nesting is unrestricted.** `parent_id` on every node. A Character can contain a Map
  which contains a Session. Ordered by a fractional index so drag-and-drop never
  renumbers siblings.
- Tags are nodes. Templates are nodes. Saved views are nodes. Maps are nodes.
- Adding a new kind of thing (Ship, Deity, Faction, Heist) needs no DB migration.

The plugin features then collapse into views over that one tree:

| Reference | Becomes |
|---|---|
| dataview | Query views (filter / sort / group over nodes + fields) |
| kanban | A query view rendered as a **board**, grouped by a field |
| fantasy-calendar | Calendar node + dated nodes |
| timelines | A query view rendered as a **timeline** over dated nodes, with lanes |
| leaflet / zoom-map | Map node; pins target any node (a pin can target another map = nesting) |
| fantasy-statblocks | A `statblock` field type + renderer |
| initiative-tracker | Encounter node + a play-mode panel reading statblocks |
| longform | A tree of scene nodes + a compile/export action |
| rpg-manager | A bundled template pack (campaign / session / adventure / clue) |
| Kanka posts | Child blocks on a node, each with its own visibility (DM notes) |

One data model, ten features. That is the whole bet.

## 3. Deployment shape

- **One image.** A single Node process serving both the API and the built static client
  on one port.
- **One volume.** `/data` holds `worldapp.db` (SQLite, WAL) and `assets/`. Backup is a
  file copy; restore is a file copy.
- **No external database, no Redis, no queue** for v1. A homelab container should be one
  `docker run` with one mount.
- `compose.yaml` in-repo. Reverse proxy (Caddy) or Tailscale for remote access; the app
  itself only needs `PORT`, `DATA_DIR`, `BASE_URL`, `SESSION_SECRET`.
- First run creates the owner account through a setup screen, not through env vars.
- Health endpoint, structured logs to stdout, migrations run automatically on boot.

SQLite is a deliberate choice, not a shortcut: single-writer is fine for a table of six
people, FTS5 covers search, and it makes the container trivially portable. If concurrency
ever becomes real, the Drizzle schema ports to Postgres without touching app code.

## 4. Stack

- **Server:** Node 24 + TypeScript, Fastify. Node runs the TypeScript directly (type
  stripping), so the server has no build step and the container copies source.
- **DB:** SQLite via **`node:sqlite`** (Node's built-in, SQLite 3.50, FTS5 included) —
  *not* better-sqlite3. It needs no native compilation, which means `npm install` works
  on a bare Windows box and the image needs no build toolchain. `migrations/*.sql` is the
  source of truth; `db/types.ts` mirrors it by hand. An ORM (Drizzle) earns its place at
  P3 when the view engine needs a dynamic query builder — not before.
- **Assets:** content-hashed files on disk under `$DATA_DIR/assets/`, served at `/media/`
  (`/assets/` belongs to the client bundle); the DB holds metadata. `sharp` arrives with
  map tiling at P4.
- **Client:** React + Vite + TanStack Query, Tailwind. URL state is hand-rolled while
  there is exactly one route shape; a real router lands when there are real routes.
- **Editor:** a markdown textarea with `[[` autocomplete in P0. TipTap (ProseMirror) with
  custom nodes for wikilinks, embeds, statblocks, GM-only secret blocks and inline query
  views replaces it later — the storage format is already final, so that swap touches one
  component.
- **Maps:** Leaflet with `CRS.Simple` over pre-cut tiles — the same approach
  obsidian-leaflet uses and, as it turns out, the same one LegendKeeper uses.
- **Auth:** cookie sessions for the browser; scoped bearer tokens for API and MCP.
- **Realtime (later):** Yjs + y-websocket for live co-editing.

**Content format:** node bodies are stored as **Markdown** (CommonMark + `[[wikilinks]]`
plus a directive syntax for embeds and statblocks), not editor JSON. Portable, diffable,
exportable to an Obsidian vault, and — critically — an LLM over MCP can read and write it
natively. TipTap round-trips markdown on load and save.

## 5. Users, roles and visibility

Core, not a late feature. Modelled on Kanka's campaign roles plus per-entity permissions,
simplified. Detail in [kanka-mapping.md](kanka-mapping.md).

- **World** (Kanka's "campaign") is the permission boundary. One server hosts many.
- **Roles per world:** `owner`, `dm`, `player`, `guest`. Roles are rows, so custom roles
  stay possible later.
- **No email, anywhere, ever.** ✅ built. This is self-hosted with no SMTP by design.
  Accounts identify by **username**, not address. There is no self-service signup: the
  owner's account is created at first-run setup, and every account after that is created
  by a DM, from the world's member panel — username, display name and a password the DM
  sets — in the same action that adds them to the world. A DM can also reset a forgotten
  password outright (no reset-by-email possible), and anyone can change their own
  password given the current one. See [HANDOFF.md](HANDOFF.md) §7.3.
- **Guests, decided 2026-08-22: both mechanisms, not one. ✅ both built.** A guest can be
  a real account (owner/DM creates it the same way as a player, capped at the `guest`
  role) **and**, separately, an anonymous share link scoped to one page's subtree, no
  account at all. A share link grants read access to the node it was made on regardless
  of that node's own visibility — sharing a `members`- or `dm`-visibility page is the
  point — but its subtree only cascades as far as ordinary guest visibility already
  reaches, so a DM-only page nested under a shared page does not leak just because its
  parent was handed out. See HANDOFF.md §7.5.
- **Node visibility** (fast path, one column): `public` / `members` / `dm` / `private`.
  A guest on a share link sees only `public` (plus the one shared root); a logged-in
  player sees `public` plus `members`; the DM sees everything.
- **Per-node ACL overrides** (Kanka's `entity_user`): grant read and/or edit to a specific
  user or to a whole role, on top of a page's own visibility. ✅ built, deliberately
  **additive only** — there is no deny entry, so a grant can only widen access, never
  take it away. See HANDOFF.md §7.4.
- **Posts carry the same levels**, so a Location node can be player-visible while its
  "DM Notes" post stays `dm`. This is the most-used feature of the current Kanka setup
  and it has to work on day one. ✅ built in P0.
- **Secret blocks** inside a body are stripped server-side for non-DM readers, before the
  markdown ever leaves the API. **This is the mechanism people actually reach for** — in
  a real LegendKeeper world, inline secrets were used 70 times against 3 hidden sections
  (§10.3 of the observations). ✅ built.

Rule: visibility is enforced in one authorization layer that every query passes through.
Never in the UI, never per-route.

## 6. Schema sketch

```
users         id, username, name, password_hash, is_server_admin, created_at
worlds        id, name, slug, owner_id, settings (JSON)
memberships   world_id, user_id, role (owner|dm|player|guest)
api_tokens    id, user_id, world_id?, name, hash, scopes, last_used_at, revoked_at

nodes         id, world_id, parent_id, template_id, kind, title, slug, body_md, icon,
              aliases (JSON), cover_asset_id, sort_key (fractional index), visibility,
              is_archived, created_by, created_at, updated_at
posts         id, node_id, title, body_md, visibility, position, created_by
acl           node_id, subject_type (user|role), subject_id, can_read, can_edit
templates     id, world_id, name, icon, field_schema (JSON), default_body_md
fields        node_id, key, type, value_text, value_num, value_date, value_ref
              -- one row per field so query views can index and filter fast
links         src_node_id, dst_node_id, kind (wikilink|embed|field_ref), anchor
relations     src_node_id, dst_node_id, label, reverse_label, attrs (JSON)
tags          node_id, tag_node_id            -- tags are just nodes
assets        id, world_id, sha256, mime, width, height, path, orig_name
maps          node_id, asset_id, min_zoom, max_zoom, bounds, crs
map_layers    id, map_node_id, name, asset_id, opacity, z, is_default
map_markers   id, map_node_id, layer_id, x, y, shape, icon, label, target_node_id,
              visibility
calendars     node_id, schema (JSON: months, weekdays, leap rules, moons, eras)
dates         node_id, calendar_id, start_abs (int MINUTES), end_abs, precision, lane,
              real_date
views         node_id, kind (table|board|timeline|gallery|graph|calendar), query (JSON),
              config
audit_log     id, world_id, user_id, action, target, payload, at
```

Notes:

- **Inline secret blocks need no column.** `:::secret ... :::` is markdown syntax inside
  `body_md` itself, redacted by role at read time — the same pattern as `visibility`, just
  finer-grained. Built; see §7.2 of HANDOFF.md.
- `start_abs` is an absolute integer **minute** count within a calendar, so sorting,
  ranges and "what happened between X and Y" are integer queries. Minutes rather than days
  because a calendar carries hours and minutes and events have a time of day — this
  follows LegendKeeper, whose calendars store `startsAt` and `maxMinutes` in minutes.
  Their whole calendar schema is worth copying: see
  [legendkeeper-observations.md](legendkeeper-observations.md) §9.5, including the
  `"400,!100,4"` leap-rule mini-DSL, eras with `startsAt`/`resetMode`, moons, and a format
  token language. Display formatting is a pure function of the calendar schema. `lane`
  matches the existing Kanka timeline export in `TheOpenBin/07_DND/kanka_events.json`.
- `nodes.aliases` (a JSON array) lets `[[Cap]]` resolve to "Captain Daigo". LegendKeeper
  carries `aliases[]` on every resource and it is cheap to add.
- `fields` as rows (rather than only JSON) is what makes dataview-style querying cheap.
- `visibility` + `acl` + `posts.visibility` is what makes DM / player / guest work
  without a second app.

## 7. API + MCP — built

Rule: **the web client uses only the public API.** No private backdoor routes. That
structurally guarantees the API is complete enough for MCP, scripts, and a future mobile
view. It has already paid off once: the MCP server inherited the whole security model for
free, and a read-only token provably cannot write through an assistant.

- REST/JSON under `/api/v1`. **OpenAPI generated from the Zod schemas** — served at
  `/api/v1/openapi.json`, with a small viewer at `/api/v1/docs`, and written to
  `docs/openapi.json` by `npm run openapi` so contract drift shows up as a diff.
- Every DTO in `packages/schema` is a Zod schema with its TypeScript type inferred from
  it. Add a response field there and server validation, client types, the spec and the
  MCP signatures all follow. That is what makes the spec generated rather than
  maintained.
- Auth: session cookie for the browser, scoped revocable bearer tokens for everything
  else (`world:read` ⊂ `world:write` ⊂ `admin`), optionally pinned to one world.
  **A token acts as its owner and inherits their role; scopes only ever narrow that.**
  Tokens cannot manage tokens — that would route around their own scopes and expiry.
- The **MCP server ships in-repo** (`apps/mcp`) as a thin adapter over that same API,
  over stdio. Built: `list_worlds`, `get_tree`, `find_nodes`, `get_node`,
  `list_unresolved_links`, `create_node`, `update_node`, `move_node`, `archive_node`,
  `create_post`, `update_post`. Declared but not yet implemented, so the shape is
  visible: `place_marker`, `add_event`, `advance_calendar`.

Still to come: streamable-HTTP transport for MCP, an `audit_log` so every write is
attributable, and webhooks so a Discord bot or Foundry can react.

## 8. Build phases

Each phase ends deployed to the homelab and usable at a real session. Nothing ships as
"foundation only".

**P0 — Spine in a container. ✅ built.** Repo scaffold, Dockerfile + compose, SQLite
migrations, users / sessions / first-run setup, worlds + memberships + roles, node CRUD,
unrestricted nesting tree with drag-and-drop, markdown editor, `[[wikilinks]]` with
autocomplete, backlinks panel, unresolved-link list, FTS5 search with a Ctrl+K switcher,
posts with per-section visibility, image upload, page icons, archive.

Two things landed earlier than planned because they were cheap now and expensive to
retrofit: **roles and per-node/per-post visibility** (P2's core), and the flat short-id
URL scheme. `npm run smoke` walks the whole surface and asserts the DM/player boundary in
each of the four places it could leak.

**P1 — API, tokens, MCP. ✅ complete.**

- **P1.1 Scoped API tokens** — bearer auth beside the session cookie, hierarchical
  scopes, optional world pin, a management UI, and the rule that tokens cannot mint
  tokens.
- **P1.2 OpenAPI** — generated from the Zod schemas, served and written to disk.
- **P1.3 MCP server** — `apps/mcp` over stdio, verified by driving it as a real client
  would.

**No bulk importer.** The owner runs the campaign in Kanka day to day and already has a
Kanka MCP server; content moves over by hand through both MCP servers as it is needed,
not as a one-shot migration. `kanka-mapping.md` and `legendkeeper-observations.md` remain
useful references — the permission-model mapping in the former and the fully
reverse-engineered export format in the latter — but neither is scheduled work. If a bulk
import is wanted later, both are specified well enough to build from cold.

**P2 — The rest of visibility.** Roles, node visibility and post visibility already work
(P0). Ordered **most-used first**, per the LegendKeeper evidence
([legendkeeper-observations.md](legendkeeper-observations.md) §10.3):

1. **GM-only secret blocks inside a body. ✅ built.** `:::secret ... :::` on their own
   lines, inside a node or post body — the fine-grained sibling of whole-post
   visibility, for a DM aside mid-prose rather than hiding a whole section. Stripped
   server-side for anyone who is not owner/DM, so a player's response never contains
   the block at all — not the text, not the fences. Excluded from the search index
   entirely (for every role, including the DM) rather than building a second index; a
   documented trade-off, not an oversight. A viewer who cannot see an existing secret
   block is blocked from resaving that body wholesale (400, not a silent delete) —
   asking a DM to edit it instead is safer than either leaking it or losing it. See
   `src/lib/secrets.ts` on both server and client, and HANDOFF.md §7.2.
2. **Username/password accounts, no email, DM-driven. ✅ built.** Resolved the P0 open
   question on how a DM adds someone who has no account yet — not an email invite (this
   is self-hosted with no SMTP, ever), but a member panel where the DM sets a username
   and password directly, in the same action that adds them to the world. Also a
   self-service "change my password" (needs the current one) and a DM-driven reset (does
   not). Migration `0004_username_accounts.sql` — a column rename, not a schema
   redesign; see HANDOFF.md §7.3.
3. **Per-node ACL overrides. ✅ built.** One-off exceptions on top of a page's own
   visibility — "this specific person" or "anyone with role X," including edit, not just
   read. Deliberately additive-only: there is no deny entry, so a grant can only widen
   access, never take it away. Migration `0005_acl.sql`; see HANDOFF.md §7.4.
4. **Anonymous share links. ✅ built.** Scoped to one page's subtree, needing no account —
   the second guest mechanism from §5 above. A link grants read regardless of the shared
   page's own visibility, but its subtree only cascades as far as ordinary guest
   visibility already reaches. Migration `0006_share_links.sql`; see HANDOFF.md §7.5.
5. **"View as a player" mode. ✅ built.** An owner/DM previewing their own world exactly
   as a player would see it, via an `x-view-as: player` header that only ever narrows —
   it does nothing for anyone who isn't already owner/DM. See HANDOFF.md §7.4.
6. **DM Menu. ✅ built.** Members, API tokens, and "view as a player" collapsed into one
   sidebar button instead of three, so the sidebar stays uncluttered as the admin surface
   grows. See HANDOFF.md §7.4.

**P3 — Templates and query views.** Template editor, typed fields, then the view engine:
table, board (kanban), gallery. Views embeddable inside a node body.

**P4 — Maps.** Map nodes, image and tiled layers, pins, pin-to-node targeting, nested
maps (a pin opens a child map), DM-only markers, polygon regions.

Store the **source image plus pixel bounds and max zoom**, and treat tiling as a derived
pipeline step — that is how LegendKeeper does it. Make pin **inheritance the default**:
in a real world 73 of 77 pins store no name, glyph or colour at all and take everything
from the page they link to (§10.5).

**P5 — Calendars, events, timelines.** Calendar schema editor (months, weekdays, leap
rules, moons, eras), date fields on any node, timeline view with lanes, per-world
"current date" with advance and retreat.

Adopt LegendKeeper's calendar schema nearly wholesale (§9.5) — it is complete and
battle-tested, and ships Harptos / Eberron / Exandria / Greyhawk presets. Copy the
timeline `detail` field too: a 1–4 zoom threshold per event is how a dense timeline stays
legible (§10.6).

**P6 — Play mode.** Statblock field type, renderer, SRD and homebrew import, encounter
nodes, initiative tracker, dice, session-notes flow.

**P7 — Hardening and extras.** Realtime co-editing (Yjs), Obsidian vault import/export,
webhooks, backup and restore UI, graph view.

## 9. Repo layout

Built so far:

```
DNDWORLDAPP/
  apps/
    server/        Fastify + node:sqlite, migrations/*.sql, API v1
    web/           React + Vite client
    mcp/           MCP server over the public API (stdio)
  packages/
    schema/        src/index.ts   Zod schemas; all DTO types inferred from them
                   src/openapi.ts builds the OpenAPI document from those schemas
  scripts/         write-openapi.mjs
  data/            worldapp.db, assets/   (gitignored; the container's /data)
  docs/            PLAN, HANDOFF, kanka-mapping, legendkeeper-observations, openapi.json
  Dockerfile
  compose.yaml
```

Planned, as their phases arrive:

```
  packages/
    markdown/      wikilink + directive parser/serializer     (P3)
    calendar/      calendar math — pure, heavily unit-tested  (P5)
```

npm workspaces. No TypeScript project references and no build step for the server — Node
24 runs the TypeScript directly.

## 10. Known risks

- **Scope.** This is six apps in a trench coat. P0–P2 must be usable on their own or it
  never ships. So far each phase has ended deployable and tested; keep it that way.
- **Permissions leak through the seams.** Every query goes through one authorization
  layer, and the player view is tested as a first-class case. There are four surfaces
  today where DM content could leak — the tree, a fetch by id, the posts list, search —
  and the smoke suite asserts all four. **Every new surface needs the same treatment and
  the same test**: map markers, timeline entries, query views, graph edges, exports,
  webhooks. This is the easiest way to ruin the app.
- **The view engine** is the hardest single piece. Keep the query a JSON filter tree, not
  a bespoke query language, at least until v2.
- **Calendar math** breeds edge cases — pure functions, unit tests, no date logic in the
  UI layer. Mitigated somewhat by adopting LegendKeeper's schema rather than inventing
  one, but the leap-rule DSL and moon phases still need real tests.
- **Building features nobody uses.** Evidence from a real LegendKeeper world: inline
  secret blocks were used 70 times, hidden sections 3, structured fields 5, aliases 0. We
  had already built the mechanism used 3 times and scheduled the one used 70 times for
  later. Check the usage evidence before investing in a feature, not after.
- **Realtime editing** is a tar pit. Deliberately last. When it comes: structure over
  REST, prose over CRDT — the seam LegendKeeper uses.
- **Schema drift between `migrations/*.sql` and `db/types.ts`.** Nothing checks it; it is
  maintained by hand in the same commit. If this ever bites, that is the moment Drizzle
  earns its place.
