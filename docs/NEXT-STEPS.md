# NEXT-STEPS — pick up here

Last updated 2026-10-22. This is the single ordered to-do list. The *why* behind the
ordering lives in [ROADMAP-2026-09-23.md](ROADMAP-2026-09-23.md); what is already built
lives in [HANDOFF.md](HANDOFF.md) §3 and [PLAN.md](PLAN.md)'s status table. Finished work
is not kept here — `git log` and HANDOFF have it.

## Just done (2026-10-22): UI audit and cleanup

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

1. **Map-editor polish** (confirmed with the owner 2026-09-23; the browse panel and the
   collapsible edit toolbar are already done):
   1. Searchable icon library — a third icon source next to emoji and image upload.
   2. Reusable marker templates — named presets of icon/color/shape.
   3. Visibility-by-zoom — a marker fades in or out past a per-marker zoom range,
      set with a two-handle slider in `MarkerInspector`.
   4. Distance measurement — calibrate a scale, then point-to-point or freehand.
2. **P4.4 fog of war** — two techniques: upgrade `map_markers.revealed` to a three-state
   room reveal, plus a freehand pixel mask (`maps.fog_enabled`, `fog_mask_updated_at`,
   both already in the schema). Ship flat feathered fog first, defer animated cloud
   drift; a DM/player view split is required. (An earlier version of this file pointed
   at a fog design section in ROADMAP; there isn't one — these notes are the design.)
3. **P3 content model** — relations (a `relations` table and a "Connections" panel that
   merges them with backlinks), then a graph view, then icons-as-images, a table of
   contents, and an index view. ROADMAP §3–§4.

   **Open question for the owner:** ROADMAP §8 puts this *before* fog of war, while the
   map-polish list agreed the same day said "then fog of war." This file follows the
   map-polish agreement because it is the more specific one. Swap 2 and 3 if that's
   wrong.
4. **API realtime groundwork** — push updates, needed before the desktop companion's
   live-session features. ROADMAP §5.
5. **DM desktop companion v1**, then the **player app** as a mode of it. ROADMAP §6–§7.
6. **P3 query views** (table/board/gallery), **P5** calendars/timelines, **P6** play
   mode, **P7** hardening.

## Known loose ends (small, schedule freely)

- `@fastify/static` is still on 8.x with advisories that were shown non-exploitable
  here (AUDIT-2026-08-24 §3.1); a major bump wants a changelog read first.
- Archiving a map page does not delete its `tiles/<nodeId>/` directory.
- The right-hand panel (tags, backlinks, wanted pages, fields) is hidden below 1024px
  with no way to open it; on a phone those are unreachable.
- The web bundle is one ~1 MB chunk (Vite warns). Lazy-loading `MapView` (Leaflet) would
  take most of that off pages that are not maps.
- Several pickers in `MapView.tsx` and `Posts.tsx` still use native `<select>`s, which
  ignore the theme in some browsers' dropdown lists.

## Standing verification habit

`npm run typecheck` → `npm run build` → `npm test` → `npm run smoke` and
`npm run test:mcp` **against an isolated server on a throwaway port and data dir**, never
the owner's own instance. Every new leak surface or CRUD endpoint gets its own assertion
in `smoke.mjs` in the same commit (HANDOFF §6.5). For UI work, also look at the change at
phone width and in the Parchment theme — a raw `[#hex]` class shows up immediately there.
