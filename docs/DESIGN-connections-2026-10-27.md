# Connections: links, tags, relations, and the graph — design for the owner to mark up

Written 2026-10-27. Nothing here is built yet. The four "decide" boxes at the end are the
only things that block starting; everything else is a recommendation that can change.

## 0. The one idea

A page is connected to other pages in exactly four ways, and the app should treat them as
four flavors of **one thing** — an edge — rather than four unrelated features:

| Edge | How it's made | Direction | Who makes it |
|---|---|---|---|
| **Link** | `[[Page]]` / `@Page` in text | from the mentioning page to the mentioned one | happens as you write |
| **Relation** | "Add relation" on a page, or MCP | directional, with an optional inverse reading | deliberate, curated |
| **Field link** | a typed field of type *link* ("Ruler: Queen Isolde") | from the page to the field's target | comes with a template |
| **Placed on** | a map marker that targets the page | from the map to the page | happens when you place a pin |

**Tags are not edges.** A tag is a label on a page — a color, a filter, a way to list pages
together. Drawing a line from every `#npc` page to one "npc" blob is the classic way to make
a graph unreadable, and Kanka and Obsidian both avoid it.

Everything below follows from that: one "Connections" panel on every page that shows all
four kinds; one tag system that is about labelling and listing; one graph endpoint that
returns edges of all four kinds; one graph view that draws them with different weights.

## 1. Tags — labels, not pages — ✅ built 2026-10-27 (HANDOFF §7.15)

**Today:** `#tag` in text creates a *page* of kind `tag`; the tagged pages show up in that
page's backlinks. It works, but a tag page has nothing on it, can be renamed into
nonsense, and can't be colored or nested.

**Proposed:**

- A `tags` table: `id, world_id, name (unique, case-insensitive), color, description,
  parent_tag_id`. `node_tags(node_id, tag_id)` as now. The `kind: "tag"` page kind goes
  away (migration converts each existing tag page into a `tags` row, keeping any body text
  as the description, then archives the page).
- **Three ways to tag a page:** `#tag` inline in the text (as now — creates or reuses);
  a **tag chip row** in the Info panel with autocomplete, so a page can be tagged without
  writing `#tag` somewhere in its prose; and a `tags` argument on `create_node` /
  `update_node` over MCP.
- **Nested tags** with `/`: `#npc/villain` is a child of `#npc`, so filtering by `#npc`
  includes villains. Cheap to build, and it's what Obsidian users expect. *(Decide 1.)*
- **A Tags view** (sidebar "Tags" → a real screen, not a folder of fake pages): every tag
  with its count and color, sortable by name or count; click a tag to see its pages, with
  the usual kind/visibility info; multi-select to intersect ("`#npc` and `#villain`").
  Rename, recolor, merge-into, delete from here.
- **Tag colors show up** as a small dot on tree rows and Ctrl+K results, and as the
  default node color in the graph.
- Visibility: a tag itself is not secret; a page a viewer can't see never appears in a
  tag's list (same filtering as search). A `#tag` written only inside a secret block does
  not tag the page for anyone who can't read the block — already true, stays true.

## 2. Relations — typed, directional, readable both ways — ✅ built 2026-10-27 (HANDOFF §7.16)

A `relations` table, modelled on Kanka's (confirmed shape) but with one addition:

```
relation: id, world_id,
          source_node_id, target_node_id,
          label            "reports to"        — free text, autocompleted from this world's existing labels
          inverse_label    "commands"          — optional; how the target's page reads it
          two_way          false               — true means one symmetric label ("allies", "siblings")
          note             short free text     — "since the coup", optional
          visibility       public | members | dm (same scheme as markers/fields)
          created_by, created_at, sort_key
```

- **Free text labels with autocomplete**, not a fixed vocabulary you have to manage first.
  Previously used labels in the world are offered as you type, and each distinct label
  gets a stable color (so "reports to" is always the same color in the graph). An optional
  inverse label is a *reading*, not a second row: Mira's page says "reports to → Queen",
  the Queen's page says "commands ← Mira". If you'd rather manage a fixed list, say so.
  *(Decide 2.)*
- **Visibility is per relation** — "secretly serves the Cabal" can be DM-only while
  "captain of the Silver Hand" is public, on the same page.
- **Link-type fields count as relations in the graph** (label = the field's name). No
  migration: they already exist and already target pages. The Connections panel lists them
  under relations with a small "field" mark.
- API: `GET/POST /nodes/:id/relations`, `PATCH/DELETE /relations/:id`; a `relations`
  section in `get_node` output and `add_relation` / `update_relation` / `delete_relation`
  over MCP. Events: `node.changed` for both ends.

## 3. The Connections panel (replaces "Mentioned in") — ✅ built 2026-10-27 (HANDOFF §7.16)

Every page's Info panel gets one **Connections** section instead of today's separate
Tags / Mentioned in / Wanted pages blocks:

```
TAGS        [#npc ×] [#ally ×] [+ tag]

RELATIONS   → reports to   👑 Queen Isolde Marr          (DM)   ✎
            ← commands     🛡 Captain Mira Voss  (from the Queen's side)
            ↔ allies       🤝 The Silver Hand
            ⚑ Ruler        (field)  👑 Queen Isolde Marr
            [+ Add relation]

MENTIONED IN   📜 Session 1 …   🏘 Thornwick …
LINKS TO       🌲 Gloomwood …   (outbound, new — today only inbound is shown)
ON MAPS        🗺 World Map (pin), 🗺 Thornwick Town Map
WANTED         [[Old Hobb the Hermit]] ×2   (create)
```

"Add relation" is a small inline form: pick a page (the same `@` picker as the editor),
type a label (autocomplete), optional inverse, two-way toggle, visibility, note. Each row
has a tiny "open local graph here" affordance (§5).

## 4. The web: one graph endpoint

`GET /worlds/:id/graph` (and `?focus=<nodeId>&depth=1..3` for the local version) returns:

```
nodes: [{ id, title, icon, kind, effectiveVisibility, tagIds[], parentId, degree }]
edges: [{ id, type: "link" | "relation" | "field" | "map" | "parent",
          source, target, label?, inverseLabel?, twoWay?, visibility? }]
tags:  [{ id, name, color }]
```

Filtered server-side with the same rules as everything else: a node the viewer can't see
is absent along with every edge touching it; a DM-only relation is absent for players;
links written inside secret blocks were never indexed in the first place. "View as a
player" works on it like on any other screen. `parent` edges (the folder structure) are
included so the client can offer them as a layer, off by default. *(Decide 3.)* `map`
edges likewise. *(Decide 4.)*

Scale: a campaign is hundreds to low thousands of pages — fine for a canvas library. The
endpoint caps at 5,000 nodes and tells the client to filter if there are more.

## 5. The graph view — one visual language, two scopes

**Library:** cytoscape.js with the `fcose` layout (force-directed, good defaults) and
`dagre` for an optional top-down "tree" layout. Canvas-based, actively maintained,
handles this scale comfortably; the roadmap research (ROADMAP §3) already compared the
alternatives.

**Two scopes, one component:**
- **Global graph** — a real screen (sidebar button "Graph", and `Ctrl+G`). Everything you
  can see, with filters.
- **Local graph** — the same component inside a page's Info panel (small, depth 1, "expand"
  to 2–3) and openable full-size from the Connections panel. This is the one people
  actually use day to day; Obsidian's usage bears that out.

**Visual language (fixed, so every graph in the app reads the same way):**

| Thing | Drawn as |
|---|---|
| Page | circle, size by number of connections (min/max clamped), the page's icon inside (emoji/library/image all work — same `Glyph` rules), title under it |
| Node color | the page's first tag's color; untagged → by kind (document grey, map green…). Toggle: color by kind instead. |
| Relation | **bold, colored by label**, arrowhead, label on hover and when zoomed in; two-way → arrowheads both ends |
| Field link | same as relation but dashed, label = field name |
| Link | thin, near-grey, no label, no arrowhead (ambient) |
| Placed on | thin dotted, from the map node (toggle layer) |
| Parent/child | faint, straight, only with the "structure" layer on |
| DM-only page or relation | a lock badge on the node / a dashed edge, only ever shown to GMs |
| Selected node | highlighted; neighbors stay full color, everything else fades to 25% |

**Controls (same placement as the map editor's, so the two screens feel like siblings):**
top-right toolbar — search/focus a page, layout (force / tree), fit, "color by" (tag /
kind); bottom-left panel — layers (relations, links, fields, maps, structure), tag filter
(multi-select, same chips as the Tags view), kind filter, depth slider (local only), legend.
Click a node → the same summary card the map uses (icon, title, first lines, "Open page",
"Focus here"); double-click → open the page; drag to rearrange (positions aren't saved —
layout is recomputed; saving positions is a later nice-to-have). Hover an edge → its label
and note. Right-click a node → "Add relation from here" opens the §3 form prefilled.

**Uniformity rules:** no colors outside the design tokens; the tag palette is a fixed
12-color set so tags look consistent across tree dots, chips and graph nodes; edge
weights are three (bold/thin/faint) and never more; everything the graph shows is
reachable in the Connections panel in text form, so the graph is a view, not the only
way in.

## 6. Build order (each step ships on its own, with smoke tests)

1. **Tags redo** — tables + migration, chip editor, Tags view, colors in tree/Ctrl+K,
   MCP `tags` argument. Removes `kind: "tag"` pages.
2. **Relations** — table, API, Connections panel (also brings "Links to" and "On maps"),
   MCP tools.
3. **Graph endpoint + local graph** in the Info panel.
4. **Global graph** screen with filters and layouts.
5. Polish: saved positions, keyboard navigation, printing/export as PNG.

Rough size: 1 and 2 are each about the size of the archive/trash work; 3+4 together about
the size of fog of war.

## 7. Decide (the only blockers) — all four answered **yes** on 2026-10-27

1. **Nested tags** (`#npc/villain`, filter by parent includes children) — yes / no?
   *Recommend yes.*
2. **Relation labels** — free text with autocomplete + optional inverse (recommended), or
   a fixed list you manage in a settings screen?
3. **Folder structure as a graph layer** (parent/child edges, off by default) — include?
   *Recommend yes, it's nearly free.*
4. **Maps in the graph** ("placed on" edges from a map to its marked pages, off by
   default) — include? *Recommend yes, same reason.*
