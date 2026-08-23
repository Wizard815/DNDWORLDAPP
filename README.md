# DNDWORLDAPP

A self-hosted worldbuilding and campaign app: **LegendKeeper's freeform structure**, on
**Kanka's self-hosted footing**, with the API and MCP server neither of them gives you.

One tree. Anything nests inside anything. A map is a page, a timeline is a page, a
character is a page — type is a filter, not a folder you are forced to live in.

**Status: P0, P1 and P2 done, plus a P2.4 editor rewrite** — the spine, scoped API
tokens, a generated OpenAPI spec, an MCP server, inline `:::secret` blocks,
username/password accounts with a DM member panel (no email, ever — this is self-hosted
with no mail server), per-node ACL overrides, anonymous share links, "view as a player,"
and a live TipTap document editor (slash commands, page linking, inline DM-notes
sections, columns, hover-to-link). Next is templates and query views. No bulk importer
is planned; content moves in through the API/MCP as needed.

**Picking this up? Read [docs/HANDOFF.md](docs/HANDOFF.md) first** — it covers what
exists, the rules that must not be broken, the environment gotchas, and the next tasks in
order. [docs/PLAN.md](docs/PLAN.md) has the product roadmap.

## Run it

```bash
npm install
npm run dev:server
```

In a second terminal, for hot-reloading UI work:

```bash
npm run dev:web
```

The server serves the API and, once `npm run build` has been run, the client too — on
one port. Open http://localhost:8080 and the first screen creates your owner account and
first world.

### In Docker, which is the real target

```bash
docker compose up -d --build
```

Put a `SESSION_SECRET` in a `.env` next to `compose.yaml` first:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Everything that matters lives in one volume at `/data` — the SQLite database and
uploaded images. Backup is a copy of that directory.

## What works today

- **Users, sessions, roles.** Owner / DM / player / guest, per world. Accounts identify
  by username, not email — there is no self-service signup and no mail server, ever. The
  owner's account is created at first-run setup; every account after that is created by
  a DM, from the world's member panel, with a username and a password the DM sets. A DM
  can also reset a forgotten password outright, and anyone can change their own given
  the current one.
- **The tree.** Unrestricted nesting, drag to re-parent, drag between siblings to
  reorder. Ordering uses fractional index keys, so a drag rewrites one row.
- **Pages.** A live TipTap document — always editable in place, no Edit/Preview toggle —
  with autosave and an emoji icon. Type `/` for a command menu: headings, lists, quote,
  code, an image upload, a secret block, a two-column layout, or a page link.
- **Wiki links.** `[[Page]]` and `[[Page|label]]`, or `@Page` for existing pages only,
  both autocompleting from the world's tree with no network round trip. A backlinks
  panel, and a list of links pointing at pages that do not exist yet. Plain prose that
  happens to match an existing page title gets a dotted underline and a "Link" popup on
  hover — confirm to link it, nothing links itself silently.
- **Sections.** `/section` drops a player-visible, named block in wherever the cursor
  is — the old "+ Add a section" button, without the button.
- **Inline secrets and DM notes.** Type `/secret` or `/dm-notes` (or wrap
  `:::secret ... :::` by hand) for a block that hides just that part from everyone but
  the owner/DM — mid-sentence, not a whole hidden section, and editable in place like
  everything else, no separate save button. Stripped server-side, excluded from search,
  and a "Reveal" button un-hides one permanently, turning it into normal visible text.
  A viewer who cannot see an existing secret is blocked from resaving the body over it.
- **Search.** SQLite FTS5, prefix matching, ranked snippets, Ctrl+K quick switcher.
- **Images.** Content-addressed uploads.
- **One API.** The client uses only `/api/v1` — no private routes — which is what keeps
  the API complete enough for MCP.
- **Scoped API tokens.** Bearer tokens for scripts and the MCP server, pinnable to one
  world, with read / write / admin scopes. Mint them from the sidebar footer. A token
  acts as you and inherits your role; scopes only ever narrow that.
- **Per-page access grants.** On top of a page's own visibility, an owner/DM can grant
  read and/or edit to one specific account or to a whole role — "anyone with the player
  role can edit this page," not just "this one person can." Additive only: a grant can
  only widen access, never take it away.
- **Anonymous share links.** A URL that needs no account at all, revealing one page and
  its subtree — even a `members`- or `dm`-visibility page, since sharing it is the
  point. Content underneath still follows its own visibility, so sharing one page never
  silently exposes what's hidden inside it.
- **"View as a player."** An owner/DM can preview their own world exactly as a player
  would see it, one click from the DM Menu, without signing out.

## Driving it from an AI assistant (MCP)

The repo ships an MCP server in `apps/mcp`. It is a thin adapter over the same public
HTTP API — no database access, no privileged path — so it can see and do exactly what its
token's owner can, no more.

1. In the app: sidebar footer → **API tokens** → name it, choose **Read + write**, leave it
   pinned to one world. Copy the secret; it is shown once.
2. Point your assistant at it:

```json
{
  "mcpServers": {
    "dndworldapp": {
      "command": "node",
      "args": ["/path/to/DNDWORLDAPP/apps/mcp/src/index.ts"],
      "env": {
        "DNDWORLDAPP_URL": "http://localhost:8080",
        "DNDWORLDAPP_TOKEN": "dwa_...",
        "DNDWORLDAPP_WORLD": "optional-world-id"
      }
    }
  }
}
```

Tools: `list_worlds`, `get_tree`, `find_nodes`, `get_node`, `list_unresolved_links`,
`create_node`, `update_node`, `move_node`, `archive_node`, `create_post`, `update_post`.
`place_marker`, `add_event` and `advance_calendar` are registered but report that they are
not built yet, so the eventual shape is visible.

Because it goes through the API, a **read-only token cannot write through MCP** — the
scope check is the same one the browser hits.

## API reference

The OpenAPI spec is generated from the Zod schemas in `packages/schema`, so it cannot
drift from what the server actually validates:

- `/api/v1/openapi.json` — the spec
- `/api/v1/docs` — a small readable viewer
- `npm run openapi` — writes `docs/openapi.json`, so drift shows up in review

## What does not exist yet

Maps, calendars, timelines, templates and typed fields, query views, boards, statblocks.
Those are P3 through P6 in the plan, in that order. No bulk importer from Kanka or
LegendKeeper is planned — content moves over by hand through the API/MCP as needed.

## Layout

```
apps/server      Fastify + SQLite. Node runs the TypeScript directly — no build step.
apps/web         React + Vite client.
apps/mcp         MCP server, over the public HTTP API.
packages/schema  Zod contract shared by the server, the client and the MCP server.
docs/            Plan, handoff, Kanka mapping, LegendKeeper findings, openapi.json.
```

## Decisions worth knowing

- **`node:sqlite`, not better-sqlite3.** Node 24 ships SQLite 3.50 with FTS5. No native
  compilation means `npm install` works on a bare Windows box and the container image
  needs no build toolchain. `migrations/*.sql` is the source of truth for the schema;
  `db/types.ts` mirrors it by hand.
- **Markdown in the database, not editor JSON.** Portable, diffable, exportable to an
  Obsidian vault, and an LLM over MCP can read and write it directly.
- **Short opaque node ids in URLs** (`/n/ox9119wx`), the way LegendKeeper does it. Moving
  a page in the tree never changes its address, so reorganising never rots links.
- **Visibility is enforced in one place** (`auth/policy.ts`), in SQL, on every read path.
  Hidden rows are never sent and then hidden — they are never sent. A DM-only page
  answers 404, not 403, so ids cannot be probed.
- **The editor is TipTap now** (P2.4, replacing P0's textarea) — because the storage
  format was already final markdown, the swap touched one component and needed zero
  server changes.

## Tests

```bash
npm test          # unit: fractional indexing, wiki-link parsing, secret blocks
npm run smoke     # 75 end-to-end API checks (needs an EMPTY data/ dir + running server)
npm run test:mcp  # drives the MCP server over stdio (needs a running server)
npm run typecheck
```

The smoke suite asserts the DM-versus-player boundary in every place it could leak — the
tree, a direct fetch by id, the posts list, search, and inline `:::secret` blocks (in
both node and post bodies, including that a viewer who cannot see one is blocked from
resaving over it) — plus the token scope rules. The MCP test additionally proves a
read-only token cannot write through an assistant.
