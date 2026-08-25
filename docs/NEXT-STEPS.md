# NEXT-STEPS — pick up here

Written 2026-08-25, at a deliberate stopping point mid-feature. This is the concrete,
step-by-step continuation of the session that just landed P4.5 (party/army tokens) and
started map display groups. Read `docs/HANDOFF.md`'s "Known open items" entry for this
same work first — it has the design decisions already made; this doc is the task list.

## 1. Finish map display groups (Kanka's `MapGroup`) — do this first

Everything server-side is done and verified: migration `0010`, `services/mapGroups.ts`
(full CRUD, cycle-checked `parent_group_id` nesting, fractional-index `sort_key` as
z-order), the routes in `routes/maps.ts`, and the `apps/web/src/api.ts` client methods
(`mapGroups`, `createMapGroup`, `updateMapGroup`, `moveMapGroup`, `deleteMapGroup`).
`npm run typecheck` and `npm run smoke` are both clean against this. **Nothing in the
client renders or uses any of it yet.**

Also already done, inside `apps/web/src/components/MapView.tsx`, ahead of the UI:
- `groupsQuery` (`useQuery(["map-groups", node.id], ...)`) and the four mutations
  (`createGroup`, `updateGroup`, `moveGroup`, `removeGroup`) are wired up.
- `useHiddenMapGroups(mapNodeId)` — the personal/local visibility-toggle hook,
  `localStorage`-backed, keyed `dwa:hiddenMapGroups:${mapNodeId}`. Returns
  `{ hiddenIds: Set<string>, toggle(groupId) }`.
- `groupsById`, `isGroupEffectivelyHidden(groupId)` (walks the parent chain, cycle-safe),
  and `visibleMarkers` (the filtered + z-ordered marker list) are all computed and
  **already wired into the render loop** — `visibleMarkers.map(...)` replaced the old
  `markers.map(...)` call. The raw `markers` array still backs `selected` and the
  existing "Group (parent token)" dropdown, unaffected.
- `groupsPanelOpen` state exists (`useState(false)`) but nothing reads it yet.

### What's actually left

1. **A toggle button + the panel itself.** I was mid-edit on this exact spot when the
   session ended — here's the problem I'd found and not yet solved: the whole map
   toolbar (`🖼 Replace image`, the shape-adder buttons, Done/Cancel) is wrapped in
   `{node.canEdit && (...)}`. A **view-only toggle** (checking/unchecking a group to
   declutter your own screen) should work for players too, not just the DM/editor — so
   a "🗂 Groups" button can't just get dropped inside that same `canEdit`-gated block.
   Restructure so the outer toolbar container always renders; keep the
   `canEdit`-only bits (upload input, shape buttons, Done/Cancel) conditionally
   rendered *inside* it, and put "🗂 Groups" as an always-rendered button in the same
   bar (or its own small always-visible control near it — either is fine, just don't
   gate the toggle itself behind `canEdit`).
2. **The panel component** (call it `MapGroupsPanel`, styled like `MarkerInspector` —
   `absolute`, a dark card, `z-[1000]`; put it bottom-*left* so it doesn't collide with
   the inspector, which is bottom-right). For each group, in nested order
   (indent by walking `parentGroupId`):
   - A checkbox bound to `!hiddenGroups.hiddenIds.has(group.id)`, `onChange` calls
     `hiddenGroups.toggle(group.id)`. No server round-trip — purely local.
   - The group's `color` as a small swatch, and its `name` — inline-editable on click
     (same "turn the row into a text input, no popup" pattern `Sidebar.tsx`'s rename
     already uses), calling `updateGroup.mutate({ id, name })` on commit.
   - Up/down buttons calling `moveGroup.mutate({ id, beforeId/afterId: <adjacent
     sibling's id> })` — reuse the exact neighbour-key-lookup pattern
     `services/fields.ts::moveField` and `services/mapGroups.ts::moveMapGroup` already
     implement server-side; the client just needs to find the right sibling id.
   - A delete button (`removeGroup.mutate(id)` — the server already `ON DELETE SET
     NULL`s the group's markers and any child groups, so this is safe with no
     confirmation dialog needed, matching how deleting other one-off pins works today).
   - A "+ add a child group" affordance nested under each row, plus one "+ New
     top-level group" button at the panel's bottom, both calling `createGroup.mutate`.
3. **A "Group" dropdown in `MarkerInspector`** — for the general `map_groups` feature,
   **separate from** the existing "Group (parent token)" dropdown (that one sets
   `parentMarkerId` and only ever appears for `shape === "token"`). This new one sets
   `groupId` and should appear for **every shape**, listing `groups` (already need to
   thread the `groups` array into `MarkerInspector`'s props the same way `markers` was
   threaded in for the token-parent feature — same pattern, one more prop). Save via
   `onSave({ groupId })`.
4. **MCP tools for group CRUD**, mirroring `place_marker`/`update_marker`'s pattern in
   `apps/mcp/src/tools.ts` (and the `client.ts` methods they call): `list_map_groups`,
   `create_map_group`, `update_map_group`, `delete_map_group`. Also add `group_id` as
   an optional field on the existing `place_marker`/`update_marker` tools (mapped
   explicitly in the handler, **not** spread — see the `update_marker` bug this same
   session found and fixed for exactly why implicit spreading is dangerous here).
5. **Tests.** Once the UI exists: a `smoke.mjs` section for the group CRUD/move/delete
   endpoints (the server code has no automated test coverage yet — it was verified only
   by the smoke suite's *other* checks still passing, i.e. "didn't break anything,"
   not "this works"). Add the same kind of assertions already used for other CRUD
   resources (create → shows up in list → move → order changes → delete → children/
   markers land back at `null`, not orphaned). Plus MCP integration-test coverage for
   the new tools, matching `apps/mcp/scripts/integration-test.mjs`'s existing style.

### Don't re-litigate

- **Visibility toggle is personal/client-side, not shared/server-side.** Explicitly
  decided with the owner. Don't add a server column for it.
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

## 2. After that: the roadmap, in order

Per `docs/PLAN.md`'s own ordering, once map groups are finished:

1. **P4.4 — Fog of war.** DungeonBoard-style freehand reveal/hide mask, plus toggling a
   `polygon` marker's existing `revealed` flag (already wired in the schema, unused
   until fog lands — see `map_markers.revealed` and `maps.fog_enabled`/
   `fog_mask_updated_at`, both reserved since P4.1).
2. **P3's query views** — table/board/gallery, the last unbuilt piece of P3.
3. **P5 — Calendars, events, timelines.**
4. **P6 — Play mode** (statblocks, initiative, encounters).
5. **P7 — Hardening** (realtime, Obsidian import/export, webhooks, backup/restore UI).

## 3. Standing verification habit, worth repeating for whatever comes next

This session's pattern, worth keeping: `npm run typecheck` → `npm run build` (web) →
`npm test` (unit) → `npm run smoke` and `npm run test:mcp` **against an isolated
server on a throwaway port/data dir**, never the owner's own running dev instance.
Every new leak surface or CRUD endpoint gets its own assertion in `smoke.mjs`
(rule §6.5 in HANDOFF.md) — that discipline is what caught the P4.5 group-visibility
leak risk and the `update_marker`/`target_node_id` MCP bug before either shipped
silently broken.
