# LegendKeeper — observed structure

Three rounds of field notes on the same project (`cm5febnb60s9s13se9k3rbd9f`), the owner's
own world.

- **Sections 1–8** — 2026-08-20, from the *published viewer* (`/p/…`), unauthenticated.
- **Section 9** — 2026-08-22, from the *editor* (`/a/…`) signed in as owner: the real REST
  API and data shapes.
- **Section 10** — 2026-08-22, from real `.json` / `.lk` exports. This is the importer's
  specification, and the only round that shows document *content*.

Where rounds disagree, the later one wins. None of this is documentation — it is evidence,
gathered read-only from the owner's own account and their own exports. The export files
themselves are deliberately **not** committed: they contain the campaign's actual prose.

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
- The gap labels ("14 days later", "111 days later") are a subtraction of absolute time
  numbers. This validates storing an integer absolute time and deriving all display from
  the calendar schema. **Correction from §9.5: the unit is minutes, not days** — their
  calendars carry `hoursInDay` / `minutesInHour` / `halfClock`, so events have a time of
  day.

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

---

## 9. From inside the editor (2026-08-22, signed in as owner)

The published viewer only showed the rendered surface. Signed in, the app exposes an
undocumented **REST API v2** and the real data shapes. This section supersedes guesswork
above.

### 9.1 The API

```
GET  /api/v2/user/me/
GET  /api/v2/projects/
GET  /api/v2/invites/me/
GET  /api/v2/auth/sync-token/                      -> { token, expiresAt }
GET  /api/v2/projects/{id}/settings/
GET  /api/v2/projects/{id}/members/
GET  /api/v2/projects/{id}/invites/
GET  /api/v2/projects/{id}/resources/              -> { resources, nextCursor, hasMore }
GET  /api/v2/projects/{id}/resources/{resourceId}/ -> { resource }
GET  /api/v2/projects/{id}/calendars/
GET  /api/v2/projects/{id}/assets/
POST /api/v2/projects/{id}/resources/sync-index/   -> 402 on this plan
```

Auth is NextAuth session cookies. Resource listing is **cursor-paginated** (50 per page;
this project has 217). `tags`, `templates` and `maps` are **not** top-level collections —
they live inside the resource, which is the tell for how the model is shaped.

**Architecture split:** REST serves structure and metadata; **document content never
appears in it**. Content syncs over **Yjs** to a separate collaboration host
(`outstanding-pencil.legendkeeper.com`), authorised by the short-lived token from
`/api/v2/auth/sync-token/`. Assets and map tiles sit on their own CDNs
(`assets.` / `tiles.legendkeeper.com`).

So: *structure over REST, prose over CRDT.* That is a clean seam, and it is the same seam
we would need at P7.

### 9.2 The real model is three levels, not two

A **resource** (their word for what we call a node) looks like:

```jsonc
{
  "id": "a5yddt9v",              // 8-char short id
  "name": "Dungeon Divers",
  "parentId": "kts9p4o5",        // unrestricted nesting
  "pos": "N",                    // fractional index — single char at this depth
  "tags": ["Group"],             // plain strings, not entities
  "aliases": [],                 // alternative names
  "iconGlyph": "fas fa-dice-d20",
  "iconColor": "#C49454",
  "iconShape": "pin-medium",
  "isHidden": false,
  "isLocked": false,
  "showPropertyBar": false,
  "banner": { "enabled": false, "url": null, "yPosition": 50 },
  "permissions": { "<userId>": ... },   // per-resource, per-user
  "documents":  [ { "id", "name", "type", "pos", "isHidden", "locatorId",
                    "createdAt", "updatedAt" } ],
  "properties": [ { "id", "pos", "type", "title", "data" } ],
  "createdAt": "...", "updatedAt": "..."
}
```

The important structural fact: **a resource has no body.** It has an ordered array of
**documents**, each with its own `type`, its own `pos`, and its own `isHidden`.

Observed `document.type` values across a 21-resource sample (26 documents):

| type | count | what it is |
|---|---|---|
| `page` | 20 | ordinary prose |
| `board` | 2 | kanban/canvas |
| `time` | 2 | timeline |
| `map` | 1 | map |
| `blank` | 1 | empty placeholder |

3 of 21 resources had **more than one document** — so a page can carry a write-up *and* a
map *and* a board, presented as tabs. `locatorId` is almost certainly the Yjs document
key.

**This is a cleaner model than ours.** We have `nodes.body_md` *plus* a `posts[]` table,
which are two mechanisms for the same idea. LegendKeeper has one: the body is simply the
first document. Their `documents[].isHidden` is exactly our `posts.visibility`, and their
`document.type` is exactly our `nodes.kind` — but attached one level lower, which is why
one page can hold several renderers.

### 9.3 Properties = the facts sidebar

```jsonc
"properties": [ { "id", "pos", "type", "title", "data" } ]
```

Observed `type` values: `TEXT_FIELD`, `TAGS`, `RESOURCE_LINK`. Ordered by fractional
index, toggled per resource by `showPropertyBar`.

Only **3 of 21** sampled resources had any properties at all — corroborating section 4:
in a real, heavily-used world the structured-fields feature is mostly ignored in favour of
typing `Name:` into the prose. Design accordingly.

### 9.4 Permissions

Project roles are only **`OWNER`** and **`MEMBER`** (7 members here). There is no
DM/player/guest distinction — players are served by publishing the read-only `/p/` site.

Fine-grained control comes from **`permissions` on each resource, keyed by user id**,
present on every resource sampled. So their model is: coarse roles + per-resource
per-user overrides.

That is the same shape as Kanka's `entity_user` and as our planned P2 `acl` table — good
independent confirmation. It also means **our four roles plus four visibility levels are
genuinely richer than LegendKeeper's**, which is the differentiator the owner asked for.

### 9.5 Calendars — copy this almost wholesale

`/calendars/` returns 7 calendars, including built-in **Harptos, Eberron, Exandria,
Greyhawk** presets. The schema is the most valuable single find in this whole exercise:

```jsonc
{
  "id": "h6t2vscp", "name": "Gregorian (custom)",
  "hasZeroYear": false,
  "hoursInDay": 24, "minutesInHour": 60, "halfClock": true,
  "maxMinutes": 2103269760,
  "months":   [ { "id", "name", "length", "interval", "isIntercalary", "offset" } ],
  "weekdays": [ { "id", "name" } ],
  "epochWeekday": 1,
  "weekResetsEachMonth": false,
  "leapDays": [ { "id", "name", "month", "day", "offset",
                  "interval": "400,!100,4",     // every 4, NOT every 100, BUT every 400
                  "intercalary": false, "addsWeekDay": false, "weekDay": "" } ],
  "negativeEra":  { "id", "name", "abbr", "hideAbbr", "resetMode", "startsAt": -209877120 },
  "positiveEras": [ { "id", "name", "abbr", "hideAbbr", "resetMode", "startsAt": 0 } ],
  "moons":  [ { "id", "name", "color", "phase", "shift" } ],
  "format": { "id": "full-formal-era",
              "day":   "DDDD, MMMM D^, YYYY E",
              "month": "MMMM, YYYY E",
              "year":  "YYYY E",
              "time":  "DDDD, MMMM D^, YYYY E [at] HH:mm" }
}
```

Four things worth stealing outright:

1. **The leap-rule mini-DSL.** `"400,!100,4"` encodes "every 4 years, except every 100,
   except every 400" in one string. Arbitrary leap rules without arbitrary code.
2. **Absolute time is a minute count, not a day count.** `startsAt` and `maxMinutes` are
   minutes. Our plan says `start_abs` in *days* — **change it to minutes**, because
   `hoursInDay` / `minutesInHour` / `halfClock` mean events can carry a time of day.
3. **Eras with `startsAt` and `resetMode`**, both negative and positive, so "Before
   Arcana / Arcane Era" works without special-casing BC/AD.
4. **A format token language** (`DDDD` weekday, `MMMM` month, `D^` ordinal day, `YYYY`
   year, `E` era abbr, `[literal]`) so display is pure data, not code.

Months carry `interval` and `isIntercalary`, so a month can appear only every N years or
sit outside the weekday cycle. Moons are `phase` + `shift`.

### 9.6 Icons are glyph + colour + shape

`iconGlyph` is a FontAwesome class (`fas fa-dice-d20`), `iconColor` a hex, `iconShape` one
of `pin-medium` / `pin-icon` / `diamond-medium`.

Crucially these are **the same three fields a map pin carries** (section 5). That is *why*
a pin can inherit from its target page — it is literally the same data. Our emoji-only
`icon` column is simpler but forecloses that trick.

### 9.7 Confirmations

- `pos` values observed: `N W Z O e P A` — single-character fractional indexes, same
  algorithm family as `lib/sortkey.ts`. Confirms the approach at tree level, not just for
  map objects.
- Short opaque ids everywhere; nesting via `parentId`; no folders.
- Tags are plain strings on the resource, not tag entities. Simpler than ours — though
  ours (tags are nodes) buys taggable pages, which is a Kanka strength worth keeping.

### 9.8 What this changes for us

| Finding | Action |
|---|---|
| Calendar schema + minute-based absolute time | **Change `dates.start_abs` from days to minutes** before P5. Adopt the leap-rule DSL, eras, moons and format tokens. |
| `aliases[]` on a resource | Add it — `[[Cap]]` resolving to "Captain Daigo" is cheap and solves nickname links. |
| Resource → documents[] → content | Consider collapsing `nodes.body_md` + `posts` into one ordered `documents` list. Gets multi-renderer pages free. Real refactor; decide before P3. |
| Per-resource per-user permissions | Confirms the P2 `acl` design. Build it as planned. |
| Icon = glyph + colour + shape | Revisit when maps land at P4, so pins can inherit. |
| REST for structure, CRDT for prose | The seam to use at P7. Do not try to sync structure through Yjs. |
| Properties barely used in a real world | Keep the P3 warning: typed fields must be cheaper than typing. |

---

## 10. The export format (2026-08-22, from real `.json` / `.lk` exports)

Five exports of the owner's own world were analysed with scripts (never committed — they
contain the campaign's actual prose). This section is the importer's specification.

### 10.1 The envelope, and what `.lk` actually is

```jsonc
{
  "version": 1,
  "exportId": "kfp1m4im",
  "exportedAt": "2026-08-22T14:09:59.500Z",
  "resources": [ /* the resource and all its descendants */ ],
  "calendars": [ /* only those referenced */ ],
  "resourceCount": 72,
  "hash": "90d1a229…"            // sha256 integrity hash
}
```

**`.lk` is just gzipped JSON in this identical schema.** Same envelope, same `hash` field.
An importer needs one parser and can accept `.lk` by gunzipping first — no separate format.

An export is a **subtree**: the chosen resource plus every descendant, linked by
`parentId`, with referenced calendars bundled. Exporting the map page pulled in 72
resources, because its pins link to them.

### 10.2 Document content is Atlassian Document Format

`document.content` is a ProseMirror doc — and specifically **ADF, Atlassian's schema**.
The tells are conclusive: `bodiedExtension`, `layoutSection` / `layoutColumn`, `taskItem`
with `state: "TODO" | "DONE"`, `localId` attributes, `isNumberColumnEnabled` and
`__autoSize` on tables, and `__confluenceMetadata` on link marks. LegendKeeper built its
editor on Atlassian's editor-core.

That is useful, not trivia: ADF has a published spec and existing open-source
ADF-to-markdown converters, so the importer does not need a bespoke parser.

Full node vocabulary observed across 229 page documents:

```
doc  paragraph(9039)  text(14145)  heading(1375)  rule(885)
bulletList(988)  orderedList(64)  listItem(3301)
table(253)  tableRow(1366)  tableHeader(838)  tableCell(3673)
blockquote(54)  codeBlock(11)  hardBreak(452)
taskList(16)  taskItem(102)
layoutSection(15)  layoutColumn(32)
mention(191)  mediaSingle(3)  media(3)
extension(42)  bodiedExtension(72)
```

Marks: `strong` (4814), `em` (249), `code` (10), `link` (6).

### 10.3 The headline finding: `block-secret`

```jsonc
{
  "type": "bodiedExtension",
  "attrs": {
    "extensionType": "com.algorific.legendkeeper.extensions",
    "extensionKey": "block-secret",
    "parameters": { "extensionTitle": "Secret" },
    "layout": "default"
  },
  "content": [ /* arbitrary blocks — paragraphs, mentions, anything */ ]
}
```

**70 instances.** Compare, in the same corpus:

| mechanism | uses |
|---|---|
| `block-secret` inline in prose | **70** |
| hidden documents (`document.isHidden`) | 3 |
| structured properties (facts) | 5 |
| aliases | 0 |

That ratio is the most useful thing in this whole exercise. In a real, heavily-used world,
**secrecy happens inline, in the middle of prose** — not by hiding a whole section, and
certainly not through structured fields.

Our model has this backwards. We built per-post visibility first (the thing used 3 times)
and scheduled inline secret blocks for "P2, later" (the thing used 70 times). **Inline
secret blocks should be promoted to the front of P2.**

The other extension is `block-subpage-index` (42 uses) — the auto child-index, an
*insertable block*, not automatic page furniture. Ours renders "Pages inside"
unconditionally; theirs is placed deliberately, which is why some pages show it and others
do not.

### 10.4 Mentions are id + cached text

```jsonc
{ "type": "mention",
  "attrs": { "id": "wdrnj0aj", "text": "Las Vegra", "alias": "",
             "accessLevel": "", "userType": "", "documentId": "" } }
```

Links store the **target's 8-char id** with a **denormalised display string**. Rename-safe
by construction, at the cost of the cached text going stale unless resynced.

Ours (`[[Title]]` resolved at write time) is the opposite trade: human-readable and
portable in markdown, but rename has to re-resolve. Worth knowing both trades are
deliberate; ours suits a markdown store, theirs suits a CRDT store.

For the importer: `mention.attrs.id` maps directly through the resource id map, and
`attrs.text` is the label — emit `[[Target Name|cached text]]` when they differ.

### 10.5 Maps

The map document carries a `map` field beside its `content`:

```jsonc
"map": {
  "locatorId": "https://assets.legendkeeper.com/<uuid>.jpg",
  "mapId":     "https://assets.legendkeeper.com/<uuid>.jpg",
  "min_x": 0, "max_x": 4096,
  "min_y": -3072, "max_y": 0,
  "max_zoom": 3
}
```

The **source image is a plain URL plus pixel bounds** (4096×3072, negative y — the
Leaflet `CRS.Simple` convention) and a max zoom. Tiles are derived from it, not stored in
the export. So our `maps` table wants: source asset, bounds, max zoom. Tiling is a
pipeline step, not the source of truth.

Pins in the export are leaner than the live client state suggested:

```jsonc
{ "id": "lyv4so44", "pos": [-48.869, 120.436], "rank": "T",
  "isHidden": false, "updatedAt": 1768150397521,
  "linkedResourceId": "e9zmkrkt", "uri": "lk://resources/e9zmkrkt",
  "isSynced": true }
```

**Of 77 pins, 73 are `isSynced: true` and store no name, glyph, colour or shape at all** —
they inherit everything from the linked page. Only 4 override, and those add
`name`, `iconGlyph`, `iconColor`, `iconShape`. Four pins are hidden.

So inheritance is not a nice-to-have toggle: it is the default state of 95% of pins, and
the reason renaming a page silently updates the map. Build it that way from the start.

Note also `uri: "lk://resources/<id>"` — an internal URI scheme for linking to a resource
from anywhere (pins, timeline events). Some older rows store a bare id instead, so a
tolerant parser needs both.

### 10.6 Timelines

```jsonc
{ "type": "time", "calendarId": "h6t2vscp",
  "content": {
    "lanes":  [ { "id", "name", "pos", "size": "sm" | "lg" } ],
    "events": [ { "id", "laneId", "type": "event", "pos", "layer", "detail",
                  "start": 341472960, "end": 341475840,
                  "name", "uri", "iconGlyph", "color",
                  "imageUrl", "imageFit", "opacity", "isSynced", "data" } ] } }
```

- `start` / `end` are **absolute minutes** — confirming §9.5. (341472960 min ÷ 60 ÷ 24
  ≈ 237,134 days ≈ year 650, matching the world's "650 AE".)
- `lanes` are the timeline groups, with a display `size`.
- **`detail` (1–4) is a zoom threshold** — how far you must zoom in before the event
  appears. That is how a dense timeline stays readable, and it is a neat idea we should
  copy rather than invent.
- `layer` stacks events vertically within a lane; `pos` is the usual fractional index.
- `isSynced` again — events inherit from their linked page.

### 10.7 Media

```jsonc
{ "type": "mediaSingle", "attrs": { "layout": "center" },
  "content": [ { "type": "media",
                 "attrs": { "url": "https://assets.legendkeeper.com/<uuid>.png",
                            "type": "file", "__external": false, "id": "", "collection": "" } } ] }
```

Plain URLs on their asset CDN, with a `layout` for alignment. An importer must download
these and re-host them, or the imported world breaks the day the export's links rot.

### 10.8 Net changes to our plan

| Finding | Action |
|---|---|
| `block-secret` used 70× vs 3 hidden docs vs 5 properties | **Promote inline secret blocks to the front of P2.** We prioritised the least-used mechanism. |
| `.lk` is gzipped JSON, same schema | One importer, gunzip first. No second format. |
| Content is ADF | Reuse an existing ADF→markdown converter rather than writing a ProseMirror walker. |
| Mentions are id + cached text | Map ids through the import id map; emit `[[Name\|label]]` when the cached text differs. |
| Map = source image URL + pixel bounds + max zoom | Store the source asset and bounds; treat tiling as a derived pipeline step. |
| 73 of 77 pins inherit everything | Make pin inheritance the default, not an option. |
| Timeline `detail` zoom threshold | Copy it — it is how a dense timeline stays legible. |
| `block-subpage-index` is an insertable block | Consider making our "Pages inside" an insertable block rather than fixed furniture. |
| Media are CDN URLs | The importer must re-host, or imports rot. |
