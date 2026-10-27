# NEXT-STEPS — pick up here

Last updated 2026-10-22. This is the single ordered to-do list. The *why* behind the
ordering lives in [ROADMAP-2026-09-23.md](ROADMAP-2026-09-23.md); what is already built
lives in [HANDOFF.md](HANDOFF.md) §3 and [PLAN.md](PLAN.md)'s status table. Finished work
is not kept here — `git log` and HANDOFF have it.

## Open, in order (2026-10-27)

1. **Relations** — `docs/DESIGN-connections-2026-10-27.md` §2–3: the `relations` table,
   API + MCP, the Connections panel (relations both ways, mentioned in, links to, on
   maps, wanted). Then **the graph** (§4–5): endpoint, local graph in the Info panel,
   global Graph screen. All four design decisions were answered yes on 2026-10-27.
2. **Library icons could render better** — bigger, optionally without the colored disc,
   in the marker's color — if the owner still wants the bundled set after trying image
   icons. Not started; ask first.
3. P3 query views, P5 calendars/timelines, P6 play mode, P7 hardening — unchanged.

## Just done (2026-10-27, later) — tags as labels (design §1)

Tags are no longer pages. A `tags` table with color, description and `/` nesting; the
old tag pages were converted (same ids) and trashed. Tag by `#tag` in the text, by the
chip row in the Info panel, or over MCP; browse at `/tags` (counts, nesting, Ctrl-click to
intersect; owner/DM rename/recolor/describe/merge/delete there). Colored dots in the tree
and Ctrl+K. HANDOFF §7.15. 22 smoke checks + 3 MCP checks.

## Just done (2026-10-27) — the gap list from the audit

- Links into an archived/trashed/deleted page become "wanted" links again; restore
  re-resolves them (HANDOFF §8.4b, now resolved).
- Hard-deleting a map removes its tiles and fog files from disk.
- MCP: `trash_node`, `restore_node`, `list_removed`, `set_fog`, `create_marker_preset`,
  `update_marker_preset`, `delete_marker_preset` (integration test covers them).
- Page icons can be library icons or uploaded images, same picker as markers; every
  place a page icon shows (tree, breadcrumbs, pinned strip, Ctrl+K, mentions, share
  view, backlinks) renders through `Glyph`.

## Just done (2026-10-22, third pass)

### Marker clustering
Outside edit mode, pins and tokens that crowd together collapse into one count badge
that splits apart as you zoom in (click to zoom to it, spiderfies at max zoom). Shapes,
circles and text labels never cluster; in edit mode nothing does, so dragging works.
`react-leaflet-cluster` 2.x (the react-leaflet 4 line). HANDOFF §7.8f.

### Image marker icons
A marker's icon can be an uploaded PNG/SVG/WebP/JPG — the "Image" tab in the marker
inspector's icon picker uploads it as an ordinary world asset and stores `img:` + its
`/media/…` URL on the marker (markers and presets only; page icons stay emoji). It's drawn
as the symbol itself (40px, drop shadow, no disc), which is how brush-style map art from
K.M. Alexander, Tom Cartos, the Noun Project or freesvg.org is meant to be used. External
URLs are refused server-side. Images already used on the map are offered as one-click
picks. HANDOFF §7.8f.

## Just done (2026-10-22, second pass)

Everything below came from one round of the owner's testing notes.

### Guest login
"Guest Login" under Sign in: one click into a shared, password-less `guest` account whose
membership is forced to the read-only `guest` role every time (sees Public pages only,
never DM/players content or secret blocks, cannot edit/create/upload/mint tokens).
`GUEST_LOGIN=off` removes the button. HANDOFF §7.11.

### Map edit mode, pin summaries, presets, fog
- "✏️ Edit" is a real mode now: off, nothing drags and clicking a marker shows a summary
  card (icon, title, the first lines of the linked page, "Open page →"); on, the inspector
  and dragging come back. The Markers panel says "hidden at this zoom" and zooms to the
  marker when clicked.
- Presets now save visibility and the zoom range too (migration 0014).
- Fog: one Paint brush (left reveals, right hides) plus Dim and Move map; round or square
  brush; Ctrl+Z / Ctrl+Y undo and redo strokes; no text selection while dragging.

### Archive and Trash (migration 0015)
Two removals, both recoverable: Archive keeps a page until restored; Delete moves it to
the trash, purged for good after 30 days (at boot and daily). DM Menu → "Archived & Trash"
lists both with Restore / Trash / Delete now. Archived pages are no longer readable by
URL. Browser `confirm()` dialogs are gone (the Claude desktop browser pane cancels them
silently) — an in-app `ConfirmDialog` instead. HANDOFF §7.12.

### Inherited visibility (migration 0016)
A page's visibility can be "Inherit" (the default for new pages): the nearest ancestor's
level applies, and a page can override for itself and everything under it — a DM-only
folder with one Players page inside is now expressible. The resolved level is
materialized (`effective_visibility`) and every read path uses it. A 🔐 button next to
the visibility picker opens the per-person/per-role Access grants. HANDOFF §7.13.

### Editor
- One **Secret** block with an audience dropdown (DM only / Players / Everyone) replaces
  Secret + DM Notes + Section. Stored as `:::secret {visibility="members"}`; the server
  strips what the viewer can't read and keeps the rest with its fence.
- One **Link a page** command: `@` picks a page or creates one by typing a new name; `[[`
  still works as a typing shortcut.
- `#tag` in the sidebar filter and Ctrl+K filters pages by tag (tree rows carry `tagNames`).

## Previously done (2026-10-22, first pass)

### Fog of war follow-ups and live updates

The owner's list after the first fog pass: a Dim brush (half-strength "explored"
fog), a keep/reset prompt when replacing a fogged map's image, the raw image link
closed off while fog is on, and a WebSocket event stream so every open screen —
players' maps, the tree, pages — updates live. HANDOFF §7.8e and §7.10.

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
2. ~~**P4.4 fog of war**~~ — done, see above, including the "explored but dimmed" state.
   Still open: animated cloud drift.
3. **P3 content model** — relations (a `relations` table and a "Connections" panel that
   merges them with backlinks), then a graph view, then icons-as-images, a table of
   contents, and an index view. ROADMAP §3–§4.

   **This is next.** Ordering confirmed with the owner 2026-10-22: fog of war first,
   then this.
4. ~~**API realtime groundwork**~~ — the WebSocket event stream is in (HANDOFF §7.10).
   The companion may still want richer, typed events later.
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
