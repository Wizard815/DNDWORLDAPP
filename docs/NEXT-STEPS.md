# NEXT-STEPS — pick up here

Last updated 2026-10-22. This is the single ordered to-do list. The *why* behind the
ordering lives in [ROADMAP-2026-09-23.md](ROADMAP-2026-09-23.md); what is already built
lives in [HANDOFF.md](HANDOFF.md) §3 and [PLAN.md](PLAN.md)'s status table. Finished work
is not kept here — `git log` and HANDOFF have it.

## Just done (2026-10-22)

### Fog of war (P4.4)

The DM turns fog on per map (🌫 Fog in the map toolbar), paints reveals with a brush
(DungeonBoard-style), or marks a region "Reveals the fog". Enforced server-side: players
get darkened images/tiles and no markers under the fog, and their open maps catch up
within ~4 s. HANDOFF §7.8e has the design and its known limits.

### Distance measurement

"📏 Measure" on every map: point-to-point legs or a freehand route, with a running
total. Someone who can edit the map calibrates it once ("Set scale…" — measure a known
distance, type its real length), after which everyone sees miles/km/whatever unit was
given; `set_map_scale` does it over MCP. HANDOFF §7.8d. **That finishes the map-editor
polish list.**

### Visibility by zoom

Each marker can have a zoom range ("only from 50% in", "only up to 200%"), set with a
two-handle "Visible at zoom" slider in the marker inspector or `min_zoom`/`max_zoom`
over MCP. Stored as magnification relative to the image's own pixels so it means the
same thing on every map. HANDOFF §7.8c. Also fixed on the way: small (untiled) maps
could not be zoomed out far enough to see the whole image.

### Marker presets

Named shape + icon + color combos per world ("Tavern", "Enemy camp"): "★ Save look as
preset" in the marker inspector (owner/DM), a ★ Presets menu in the map's edit toolbar to
place from one, and `list_marker_presets` / `place_marker`'s `preset_id` over MCP. Copied
onto a marker, never linked. HANDOFF §7.8b. The edit toolbar also wraps onto a second
row now instead of squeezing its labels and sliding under the zoom buttons.

### Marker icon library

~5,500 searchable icons (game-icons.net + Font Awesome) as a third marker icon source
beside emoji and image upload — an "Icon library" tab in the marker inspector's icon
picker, a `search_icons` MCP tool, `GET /api/v1/icons`, and per-icon SVGs at
`/icons/{set}/{name}.svg`. Stored as `game-icons:castle` in the existing `icon` column.
Details in HANDOFF §7.8a.

### Loose ends from the UI audit

- The right-hand panel (tags, backlinks, wanted pages, fields) opens as a drawer from an
  "ⓘ Info" button below 1024px wide — before, it simply wasn't reachable on a phone.
- The map editor (Leaflet + `MapView`) is a lazy-loaded 247 KB chunk, so ordinary pages
  no longer download it.

### UI audit and cleanup

- **Design tokens + themes.** Every color now comes from a token in
  `apps/web/src/styles.css` (`bg-surface`, `text-fg-muted`, `border-line`, …) — about 700
  hard-coded `[#hex]` classes replaced. Three themes (Midnight, the default; Ember; and a
  light Parchment), picked from the DM Menu and kept per browser. See HANDOFF §6.6.
- **Typography.** Inter for UI text, Fraunces for page titles and document headings,
  both bundled through `@fontsource` (no CDN — this runs on a homelab).
- **Phone layout.** Below 768px the sidebar is an off-canvas drawer behind a top bar
  with a menu and search button; it closes itself when a page is picked. The page title
  row wraps instead of squeezing the title to a few letters.
- **Sidebar.** Auto-created `#tag` pages go in a collapsible "Tags" group instead of
  crowding the top level; a world's root page starts expanded on first visit; a proper
  "Search pages…" button for Ctrl+K; "+ New page" is the primary action.
- **Shared pieces.** One `.modal-backdrop` for every dialog plus `useEscapeKey` (Escape
  now closes all of them), one `.menu-item` class for every dropdown row, one
  `lib/kinds.ts` for the per-kind fallback glyph (was copied in two components).
- **Small fixes.** The right panel used `h-screen` inside a column that can also hold the
  pinned strip, so it overflowed when pins existed; it now fills its row. The panel's
  "Visibility" read `members` while the picker said "Players" — both say "Players" now.
  The sign-in form has real labels and `autocomplete` hints.

## Next, in order

1. ~~**Map-editor polish**~~ — all done as of 2026-10-22 (the list, for the record):
   1. ~~Searchable icon library~~ — done, see above.
   2. ~~Reusable marker templates~~ — done as marker presets, see above.
   3. ~~Visibility-by-zoom~~ — done, see above (markers pop in/out; a fade is not done).
   4. ~~Distance measurement~~ — done, see above.
2. ~~**P4.4 fog of war**~~ — done, see above. Still open from the original design: a
   three-state room reveal ("explored but dimmed") and animated cloud drift.
3. **P3 content model** — relations (a `relations` table and a "Connections" panel that
   merges them with backlinks), then a graph view, then icons-as-images, a table of
   contents, and an index view. ROADMAP §3–§4.

   **This is next.** Ordering confirmed with the owner 2026-10-22: fog of war first,
   then this.
4. **API realtime groundwork** — push updates, needed before the desktop companion's
   live-session features. ROADMAP §5.
5. **DM desktop companion v1**, then the **player app** as a mode of it. ROADMAP §6–§7.
6. **P3 query views** (table/board/gallery), **P5** calendars/timelines, **P6** play
   mode, **P7** hardening.

## Known loose ends (small, schedule freely)

- `@fastify/static` is still on 8.x with advisories that were shown non-exploitable
  here (AUDIT-2026-08-24 §3.1); a major bump wants a changelog read first.
- Archiving a map page leaves its `tiles/<nodeId>/` directory on disk. That is correct
  as things stand — archive is reversible (`PATCH {isArchived:false}`) and deleting the
  tiles would break a restore — so cleanup belongs with a future hard delete/purge.
- The main web chunk is still ~870 KB (mostly TipTap), so Vite still warns.
- Page icons can't use the icon library yet — see HANDOFF §7.8a for what that needs
  (ROADMAP §4's icons-as-images).
- Several pickers in `MapView.tsx` and `Posts.tsx` still use native `<select>`s, which
  ignore the theme in some browsers' dropdown lists.

## Standing verification habit

`npm run typecheck` → `npm run build` → `npm test` → `npm run smoke` and
`npm run test:mcp` **against an isolated server on a throwaway port and data dir**, never
the owner's own instance. Every new leak surface or CRUD endpoint gets its own assertion
in `smoke.mjs` in the same commit (HANDOFF §6.5). For UI work, also look at the change at
phone width and in the Parchment theme — a raw `[#hex]` class shows up immediately there.
