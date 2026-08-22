# DNDWORLDAPP — Plan

Working name: **DNDWORLDAPP** (rename later).
Deploy target: **a Docker container on the homelab.** That is the product, not a later
packaging step.

> **Status, 2026-08-22 — P0 and most of P1 are built and running.**
>
> | | |
> |---|---|
> | **Done** | The spine (tree, pages, wiki links, DM notes, search, Docker) · scoped API tokens · OpenAPI generated from Zod · the MCP server |
> | **Next** | P1.4 — the importers. LegendKeeper first: its format is fully specified and it holds the maps and timelines Kanka never had. |
> | **Then** | P2 visibility (inline secret blocks first) → P3 templates and query views → P4 maps → P5 calendars and timelines → P6 play mode → P7 hardening |
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
- **Node visibility** (fast path, one column): `public` / `members` / `dm` / `private`.
  A guest on a share link sees only `public`; a logged-in player sees `public` plus
  `members`; the DM sees everything.
- **Per-node ACL overrides** (Kanka's `entity_user`): grant or deny read/edit to a
  specific user or role — one player's secret backstory node, for instance.
- **Posts carry the same levels**, so a Location node can be player-visible while its
  "DM Notes" post stays `dm`. This is the most-used feature of the current Kanka setup
  and it has to work on day one. ✅ built in P0.
- **Secret blocks** inside a body are stripped server-side for non-DM readers, before the
  markdown ever leaves the API. **This is the mechanism people actually reach for** — in
  a real LegendKeeper world, inline secrets were used 70 times against 3 hidden sections
  (§10.3 of the observations). Not yet built; first item of P2.

Rule: visibility is enforced in one authorization layer that every query passes through.
Never in the UI, never per-route.

## 6. Schema sketch

```
users         id, email, name, password_hash, is_server_admin, created_at
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

**P1 — API, tokens, MCP, and the imports.**

- **P1.1 Scoped API tokens ✅** — bearer auth beside the session cookie, hierarchical
  scopes, optional world pin, a management UI, and the rule that tokens cannot mint
  tokens.
- **P1.2 OpenAPI ✅** — generated from the Zod schemas, served and written to disk.
- **P1.3 MCP server ✅** — `apps/mcp` over stdio, verified by driving it as a real client
  would.
- **P1.4 The importers — next.** BloodEarth from Kanka (campaign `376198`), and the
  LegendKeeper world, whose export format is fully specified in
  [legendkeeper-observations.md](legendkeeper-observations.md) §10.

**Do LegendKeeper first.** Its format is already reverse-engineered, the exports are
already on disk, and it is the world that actually holds the maps and timelines Kanka
never had — so it stress-tests the data model harder.

Each import is the migration path *and* an honest test of the data model: if a real
campaign with nested locations, hidden notes and a homebrew calendar round-trips cleanly,
the model is sound. If it does not, better to learn that now than at P5.

One hard constraint for both importers: **inline secret blocks must survive the import
as secrets.** Flattening a LegendKeeper `block-secret` into visible prose would leak the
DM's material to the players. That is a correctness requirement, not a nicety.

**P2 — The rest of visibility.** Roles, node visibility and post visibility already work
(P0). What remains, **most-used first**:

1. **GM-only secret blocks inside a body.** Evidence from a real LegendKeeper world:
   `block-secret` used **70 times**, against 3 hidden documents and 5 structured
   properties (see [legendkeeper-observations.md](legendkeeper-observations.md) §10.3).
   Secrecy happens inline, mid-sentence — not by hiding whole sections. We built the
   least-used mechanism first; this is the one that earns its keep.
2. Per-node ACL overrides for one-off exceptions.
3. Guest share links scoped to a subtree, and an explicit "view as player" mode.
4. An invite flow so a DM can add someone who has no account yet.

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

**A LegendKeeper importer belongs alongside the Kanka one in P1**, not here. The export
format is now fully specified (§10) — `.json`, or `.lk` which is the same JSON gzipped —
and the owner already has exports of the world that carries the maps and timelines Kanka
never held. Content is Atlassian Document Format, so an existing ADF→markdown converter
does most of the work.

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
    kanka-import/  Kanka API client + mapper                  (P1.4)
    lk-import/     LegendKeeper .json/.lk reader + ADF mapper (P1.4)
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
