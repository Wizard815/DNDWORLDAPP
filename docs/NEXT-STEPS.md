# NEXT-STEPS — pick up here

Written 2026-08-25, updated 2026-09-23. Section 1 (map display groups) is now **done** —
see `docs/HANDOFF.md`'s "Known open items" (the "Resolved 2026-09-14" entry) for the full
write-up of what got built and a real permission bug caught along the way. It's kept
below, struck through in spirit but left intact, as a record of the task list that was
actually followed. **§1a is where map-editor-polish work is currently in progress** — see
that section for what's done vs. still open. Skip to **§2, the roadmap**, for everything
after that.

## 1. Map display groups (Kanka's `MapGroup`) — ✅ done, 2026-09-14

Everything server-side, client-side, and MCP-side is built, typechecked, and covered by
both `smoke.mjs` and MCP `integration-test.mjs`. What follows is the original task list,
kept for context on what "done" means here:

1. ~~A toggle button + the panel itself~~ — the map toolbar's "🗂 Groups" toggle is now
   unconditional (not gated behind `canEdit`); only the upload/shape/Done-Cancel controls
   inside remain edit-only.
2. ~~The panel component~~ — `MapGroupsPanel` in `MapView.tsx`: nested checklist, checkbox
   toggle (purely local via `useHiddenMapGroups`), color swatch, inline rename, ▲/▼
   reorder, delete, add-child/add-top-level.
3. ~~A "Group" dropdown in `MarkerInspector`~~ — added as "Display group," separate from
   the existing "Group (parent token)" dropdown, applies to every shape.
4. ~~MCP tools for group CRUD~~ — `list_map_groups`/`create_map_group`/
   `update_map_group`/`move_map_group`/`delete_map_group`, plus `group_id` on
   `place_marker`/`update_marker` (mapped explicitly, not spread).
5. ~~Tests~~ — a `smoke.mjs` `== map display groups ==` section and an MCP
   `integration-test.mjs` `== map display groups ==` section, both covering
   create/nest/list/rename/move/delete, cycle and self-parent rejection, and
   delete-ungroups-not-orphans for both groups and markers.

**One thing found while writing the tests that wasn't on this original list**:
`listMapGroups` was gated by `requireMapNode` (edit-only), which meant a read-only
player could never list groups at all — silently breaking the personal-toggle feature
for exactly the audience it was built for. Fixed to use `requireVisibleNode`, matching
`listMarkers`/`getMap`. Worth remembering as a general pattern: a *read* endpoint that
exists to serve every viewer must not be gated by an *edit* check, even when the
mutations next to it correctly are.

### Don't re-litigate (still true, now that the feature is built, not just designed)

- **Visibility toggle is personal/client-side, not shared/server-side.** Explicitly
  decided with the owner, and that's what shipped — don't add a server column for it.
- **This is not the same feature as P4.5's token `parentMarkerId`.** Two different
  self-referential hierarchies exist on purpose: `map_markers.parent_marker_id` (a
  token's own party/squad split, ties into group-*visibility*-dominance) and
  `map_groups` + `map_markers.group_id` (any marker's display *category*, no
  visibility effect at all). If a future change makes you want to merge these, stop
  and re-read HANDOFF.md §7.8's note on why they're separate before doing it — it's
  modeled directly on Kanka's own split between `MapMarker.parent_id`-style hierarchy
  concepts and its actual `MapGroup` entity.
- **Don't reuse `map_layers`** for this. It's a different, older P4.6-backlog concept
  (alternate/overlay *images*, `asset_id NOT NULL`) that happens to share the word
  "layer/group" loosely with Kanka's real `MapGroup`. They are not interchangeable.

## 1a. Map-editor polish, then fog of war — in progress, 2026-09-23

Confirmed with the owner: all five polish items below, in this order, then fog of war
(P4.4, design already outlined in `docs/ROADMAP-2026-09-23.md`). Alongside these, three
UI complaints from the owner's own testing got fixed the same session (not on the
original polish list, but blocking enough to do first): the shape-adder/Replace-image
toolbar now collapses behind a "✏️ Edit" toggle instead of always showing (unconditional
`node.canEdit` clutter on a map you're just viewing); and the map container now caps at
`maxHeight: 75vh` so a tall/portrait map's toolbar and `MarkerInspector` stay reachable
without page-scroll on a full-screen browser — safe to reintroduce now because the two
zoom bugs that made a mismatched container shape look "broken" earlier (`zoomSnap`, the
zoom-out floor) are both already fixed independently. See `MapView.tsx`'s own comments
at the `editToolbarOpen` state and the root container's `style` for the full reasoning.

1. ~~Marker list/browse panel~~ — ✅ done. `MarkerListPanel` in `MapView.tsx`: a "📋
   Markers" toolbar toggle opens a searchable flat list of every marker on the map;
   clicking one selects it (opens `MarkerInspector`, same as clicking it on the map) and
   pans the map to it via a new `mapInstanceRef`.
2. **Searchable icon library** — not started. A third icon source alongside emoji and
   image-upload, ~5,500 icons (Font Awesome + game-icons.net style per `ttrpg-maps`),
   live search.
3. **Reusable marker templates** — not started. Named presets of icon/color/shape.
4. **Visibility-by-zoom layers** — not started. A marker fades in/out past a per-marker
   zoom threshold, via a dual-handle range slider in `MarkerInspector`.
5. **Distance-measurement tool** — not started. Calibrate a scale, then point-to-point or
   freehand measurement with unit conversion. Genuinely missing today, not a redesign.

After these five: **P4.4 fog of war** — see `docs/ROADMAP-2026-09-23.md`'s fog-of-war
design section for the two-technique plan (`map_markers.revealed` upgraded to a 3-state
room reveal, `maps.fog_enabled`/`fog_mask_updated_at` for a freehand pixel mask), ship
flat feathered-edge fog first, defer animated cloud-drift, DM/player view split required.

## 2. The roadmap, in order — superseded, see docs/ROADMAP-2026-09-23.md

This section's ordering is stale as of 2026-09-23 — a much larger scope decision (tags
shipped, then relations + a graph view, then a whole second/third app: a DM desktop
companion and eventual player app) landed after this list was written. `docs/ROADMAP-
2026-09-23.md` is the current source of truth for ordering and the research behind it;
this list is kept only as a record of what the plan looked like before that redo:

1. ~~P4.4 — Fog of war.~~ DungeonBoard-style freehand reveal/hide mask, plus toggling a
   `polygon` marker's existing `revealed` flag (already wired in the schema, unused
   until fog lands — see `map_markers.revealed` and `maps.fog_enabled`/
   `fog_mask_updated_at`, both reserved since P4.1). Still on the list, just resequenced
   behind P3's relations/graph work — see the new doc.
2. ~~P3's query views~~ — table/board/gallery, the last unbuilt piece of P3. Still
   unbuilt; not resequenced, just not the very next thing either.
3. ~~P5 — Calendars, events, timelines.~~
4. ~~P6 — Play mode~~ (statblocks, initiative, encounters).
5. ~~P7 — Hardening~~ (realtime, Obsidian import/export, webhooks, backup/restore UI).
   Note: the new doc pulls the *realtime* piece of this forward, ahead of the desktop
   companion app, since live-session features need it — see
   `docs/ROADMAP-2026-09-23.md` §5/§8.

## 3. Standing verification habit, worth repeating for whatever comes next

This session's pattern, worth keeping: `npm run typecheck` → `npm run build` (web) →
`npm test` (unit) → `npm run smoke` and `npm run test:mcp` **against an isolated
server on a throwaway port/data dir**, never the owner's own running dev instance.
Every new leak surface or CRUD endpoint gets its own assertion in `smoke.mjs`
(rule §6.5 in HANDOFF.md) — that discipline is what caught the P4.5 group-visibility
leak risk and the `update_marker`/`target_node_id` MCP bug before either shipped
silently broken.
