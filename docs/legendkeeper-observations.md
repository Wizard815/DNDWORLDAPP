# LegendKeeper — observed structure

Notes from inspecting a live published project (the "WIld West" / Saloon Info Hub world,
project `cm5febnb60s9s13se9k3rbd9f`) in the browser on 2026-08-20. This is the read-only
*viewer* app, so it reflects the published rendering of the editor's data, not the editor
itself. Treat it as strong evidence, not documentation.

## 1. URLs and identity

```
/p/{projectId}/{pageId}
   cm5febnb60s9s13se9k3rbd9f / zop9ysy7
```

- Project id is a cuid; page id is an **opaque 8-character id**.
- **The URL is flat regardless of nesting depth.** `NPC` and its child `Captain Daigo`
  sit at the same URL shape. Re-parenting a page never changes its URL and never breaks
  an inbound link.
- Breadcrumbs (`Saloon (Info Hub) / NPC / Captain Daigo`) reconstruct the path from the
  tree, not from the URL.

**Take this.** Our nodes should be addressed by short opaque id, with the slug as a
cosmetic suffix at most. A path-based URL would make the freeform tree hostile to use —
every reorganisation would rot links. This is arguably *the* structural reason
LegendKeeper feels fluid and Kanka does not.

## 2. One tree, mixed kinds

The project browser is a single tree whose top-level siblings are:

```
Saloon (Info Hub)        <- home page
Items (Tools/Wep)        <- category-ish page, has children
Mechanics (Custom Rules)
World Lore/Law
NPC                      <- has children: Divers, OLD, GrayHunters, Captain Daigo
Players
Ciridan (MAP)            <- a MAP, sitting as a sibling of ordinary pages
Ciridan Timeline         <- a TIMELINE, same
Camp Logs (Session)
Untitled
```

Maps and timelines are **pages in the same tree**, not separate modules in a separate
nav. There are no folders — a page with children *is* the folder. Leaf pages have no
expand chevron, so the tree knows child counts up front.

Confirms the plan's core bet: one `nodes` table, `parent_id` unrestricted, and kind is a
property of the node rather than a location in a menu.

## 3. One page shell, many renderers

The content area carries a single class pattern with a kind modifier:

```
resource-viewer ... grid-cols-[1fr_304px] map
resource-viewer ... grid-cols-[1fr_304px] timeline
```

Same shell, same 304px right sidebar, swapped body renderer. That is exactly the
"every view is a query/renderer over Nodes" model, and it is worth copying literally:
build `<NodeShell>` once (breadcrumb, title, icon, facts sidebar), then plug in
`DocumentView` / `MapView` / `TimelineView` / `BoardView`.

## 4. Facts sidebar

Every page has a right sidebar reading **"Empty sidebar — Add facts about the whole
page"**. LegendKeeper calls structured key/value data on a page *facts*; Kanka calls the
same thing *attributes*. Ours is the `fields` table.

Worth noticing: in this real world the facts sidebar is **empty everywhere**, and the
author instead typed the structure into the body by hand:

```
DOMR Rank-Up Admin
Name: Captain Daigo
Character: no magic, no bloodline gifts, just a brick-wall firefighter-soldier ...
```

Design consequence: a structured-fields feature that costs more effort than typing
`Name: x` will not get used. Ours should (a) come pre-filled from the Template, and
(b) auto-detect `Key: value` lines in the body and offer to promote them to fields.

## 5. Maps

The map page runs **Leaflet** (`window.__leafletMap`, `leaflet-pane` DOM) over **pre-cut
tiles**:

```
https://tiles.legendkeeper.com/v2/{z}/{x}/{y}.jpg   per-image UUID, zoom 2..5
```

The client map store holds these object kinds:

```
pins, labels, regions, paths, tokens, lights, walls, folders,
fogMasks, weatherMasks, gridSettings, lightingSettings,
navigationWaypoints / navigationResult   (pathfinding directions between pins)
```

plus behaviour flags: `isPinClusteringEnabled`, `isPreviewOnClickEnabled`,
`isAutoNestPinsEnabled`, `tagFilter` + `tagFilterRule`, `hiddenLayerIds`.

A pin looks like:

```json
{
  "id": "xer50mg8",
  "uri": "s2cpgmmd",
  "linkedResourceId": "s2cpgmmd",
  "name": "a",
  "pos": [-9.699468160366534, 153.698939360328],
  "iconGlyph": "eye", "iconShape": "pin-medium", "iconColor": "#EF4444",
  "inherited": { "name": "Voltaire True Sight", "iconGlyph": "eye",
                 "iconShape": "pin-medium", "iconColor": "#EF4444" },
  "isSynced": false,
  "rank": "}}}}}}}l",
  "updatedAt": 1768150397573
}
```

Three things to steal outright:

1. **`inherited` + `isSynced`.** A pin inherits its name, glyph, shape and colour from
   the page it links to, unless locally overridden. Rename the page, every pin follows.
   This was not in our plan; add it to `map_markers`.
2. **`rank` is a fractional index string.** Same technique the plan already specifies for
   `sort_key`, used here for map object ordering too. Good independent confirmation.
3. **`updatedAt` epoch-ms on every object** — last-write-wins for collaborative editing.

`isAutoNestPinsEnabled` is the "pin opens a child map" nesting behaviour, driven by the
page tree rather than configured per pin.

Fog masks, walls, lights and tokens are virtual-tabletop territory. Out of scope for us
until well past P4, but the data model should not make them impossible: keep map objects
as typed rows with a `kind`, not four bespoke tables.

## 6. Timelines

The timeline page is bound to a named calendar (**"Gregorian (custom)"**) with controls
`Timeline / Range / Groups / View`. Entries render as:

```
March, 550 AE                                      <- month section header
  World Timeline | Explorer Emhoff Rucible discovers Americanos
                 | Monday, March 2nd, 550 AE
  14 days later
  World Timeline | Discovery of Magic
                 | Monday, March 16th, 550 AE
```

- **Groups** are `Session Dates` and `World Timeline` — the same values as the `lane`
  field in the existing Kanka export at `TheOpenBin/07_DND/kanka_events.json`. Lanes and
  groups are the same concept; the plan's `dates.lane` column is right.
- The gap labels ("14 days later", "111 days later") are a subtraction of absolute day
  numbers. This validates storing `start_abs` as an integer day count and deriving all
  display from the calendar schema.

## 7. Their stack, for reference

`__NEXT_DATA__` (Next.js) + `__svelte` islands + `__ $YJS$ __` (Yjs) + Sentry, Tailwind
for styling, Leaflet for maps, FontAwesome glyphs for icons.

Yjs for realtime is the same conclusion the plan reaches — and the same reason it is
scheduled last: it is load-bearing for their multiplayer editing and it is not free.

## 8. Net changes to our plan

- Address nodes by **short opaque id**, not path. Slugs are cosmetic.
- Build **one node shell + pluggable renderers**, not separate map/timeline sections.
- Add **`inherited` / `is_synced`** to map markers.
- Give map objects a single typed table with a `kind` discriminator (pin, label, region,
  path), so regions and paths do not need new tables later.
- Add `updated_at` epoch-ms to anything that will ever sync.
- Make fields cheap to create, or nobody will use them — including you, on your own
  LegendKeeper world.
