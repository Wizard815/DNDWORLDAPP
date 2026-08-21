# DNDWORLDAPP

A self-hosted worldbuilding and campaign app: **LegendKeeper's freeform structure**, on
**Kanka's self-hosted footing**, with the API and MCP server neither of them gives you.

One tree. Anything nests inside anything. A map is a page, a timeline is a page, a
character is a page — type is a filter, not a folder you are forced to live in.

**Status: P0.** The spine works and runs.

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

- **Users, sessions, roles.** Owner / DM / player / guest, per world.
- **The tree.** Unrestricted nesting, drag to re-parent, drag between siblings to
  reorder. Ordering uses fractional index keys, so a drag rewrites one row.
- **Pages.** Markdown body, autosave, emoji icon, live preview.
- **Wiki links.** `[[Page]]` and `[[Page|label]]`, with `[[` autocomplete, a backlinks
  panel, and a list of links pointing at pages that do not exist yet.
- **DM notes.** Sections on a page, each with its own visibility. A player-facing
  location can carry a DM-only briefing, and the hidden text never leaves the server.
- **Search.** SQLite FTS5, prefix matching, ranked snippets, Ctrl+K quick switcher.
- **Images.** Content-addressed uploads.
- **One API.** The client uses only `/api/v1` — no private routes — which is what will
  keep the API complete enough for MCP in P1.

## What does not exist yet

Maps, calendars, timelines, templates and typed fields, query views, boards, statblocks,
the API tokens, the MCP server, and the Kanka importer. Those are P1–P6 in the plan, in
that order.

## Layout

```
apps/server    Fastify + SQLite. Node runs the TypeScript directly — no build step.
apps/web       React + Vite client.
packages/schema  Zod contract shared by server and client (and later the MCP server).
docs/          Plan, Kanka mapping, LegendKeeper findings.
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
- **P0's editor is a markdown textarea**, not TipTap. The storage format is already
  final, so swapping the editor later touches one component.

## Tests

```bash
npm test
```

Unit tests cover the fractional-index and wiki-link parsing logic. There is also an
end-to-end smoke script that exercises the API against a running server, including the
DM-versus-player boundary — see `docs/PLAN.md` for what P1 adds around it.
