# Kanka as the reference implementation

Kanka (`owlchester/kanka`, Laravel + MySQL) is the closest thing to a proven, self-hosted
campaign app. It has already solved the boring, load-bearing problems: entity identity,
per-entity permissions, notes with visibility levels, attributes, relations, mentions,
image handling, a token API. We copy those answers.

We reject exactly one thing: **navigation by type**. In Kanka every entity is one of ~17
fixed types and the UI files it into that type's bucket. LegendKeeper's freeform tree is
the thing worth stealing instead.

> The specifics below are written from working knowledge of Kanka's model and its v1 API.
> Before implementing the importer, verify column names, visibility enums and mention
> syntax against the actual source and against a live response from campaign `376198`.

## 1. What Kanka gets right, and we keep

| Kanka concept | Why it matters | Our version |
|---|---|---|
| `entities` spine + per-type child table | One identity per thing, so links, tags, permissions, posts and search are uniform | `nodes` — same spine, but the type lives in `template_id`, not in a separate table |
| Entity **posts** (notes on an entity, each with its own visibility) | The DM-notes mechanism. Public location, hidden DM section, same page | `posts`, same shape, same visibility levels |
| **Attributes** (typed key/value on any entity) | Ad-hoc structured data without migrations | `fields`, one row per field, typed, driven by a Template |
| **Relations** (labelled, directional edges) | "Ally of", "Rules over" — semantics that a wiki link cannot express | `relations`, plus `reverse_label` |
| **Mentions** (inline entity references in body text) | Real linking, survives renames | `[[wikilinks]]` resolved to node IDs in `links` |
| **Tags**, themselves entities | Tags can have pages, parents, permissions | Tags are nodes; `tags` is a join table |
| Campaign roles + per-entity user permissions | DM / player / guest, with per-thing exceptions | `memberships` + `acl` |
| Bearer-token API v1 | Scriptable, MCP-able | `/api/v1`, scoped tokens |
| Campaign as the boundary | Multi-campaign on one install | `worlds` |

## 2. What we change

| Kanka | DNDWORLDAPP |
|---|---|
| ~17 hard entity types, each a DB table | One `nodes` table; type = `template_id`, user-editable, no migration to add a type |
| Navigation grouped by type ("Characters", "Locations") | One freeform tree; type is a filter/facet, and "all Characters" is a saved query |
| Parent nesting only within a type (a location under a location) | `parent_id` unrestricted — anything under anything |
| Entity type determines available fields | Template declares fields; a node can override or add |
| HTML bodies | Markdown bodies (portable, diffable, LLM-writable) |
| Separate Maps / Timelines / Calendars modules | Map, Timeline, Calendar are node kinds; timeline and calendar are query views over dated nodes |
| PHP / Laravel / MySQL / Redis / queue workers | Node + TypeScript / SQLite / one container, one volume |

## 3. Entity type to template mapping

The importer creates one Template per Kanka type, so imported data keeps its shape and
the type filter still works:

```
character      -> Character      family      -> Family
location       -> Location       organisation-> Organisation
item           -> Item           note        -> Note
event          -> Event          race        -> Race
creature       -> Creature       quest       -> Quest
journal        -> Journal        ability     -> Ability
tag            -> (tag node)     map         -> Map node + maps row
timeline       -> Timeline view  calendar    -> Calendar node
conversation   -> Note (flattened, low priority)
```

Type-specific columns (`character.title`, `location.type`, `quest.is_completed`, ...)
become template fields, one `fields` row each. Nothing is dropped silently — anything the
mapper does not recognise goes into a `kanka_raw` field so it is recoverable.

## 4. Visibility mapping

Kanka's post visibility is the feature in heaviest use in BloodEarth today (the DM Notes
posts marked hidden). Map it explicitly:

| Kanka | Meaning | Ours |
|---|---|---|
| `all` / public | Everyone including guests | `public` |
| `members` | Logged-in campaign members | `members` |
| `admin` | Campaign admins / DM only | `dm` |
| `admin-self` / `self` | Author only | `private` |
| entity `is_private = true` | Hidden from non-admins | node `visibility = dm` |
| per-user entity permission | Exception for one player | `acl` row |

Enforcement rules:

- One authorization layer. Every read path resolves `(user, world) -> role`, then filters
  by `visibility` with `acl` overrides applied. No per-route checks.
- Guests exist only through a share link scoped to one node subtree, and see `public`.
- A hidden child node does not leak through its parent's tree listing, backlinks, search
  results, query views, map markers, or timeline entries. Each of those is a separate
  place to get it wrong, so each gets a test.
- The API strips `dm` content server-side; the client never receives it and then hides it.

## 5. API mapping

Kanka's v1 API is the template for ours, minus the type-per-route explosion.

```
Kanka   GET /campaigns/{c}/characters/{id}     ->  GET /api/v1/worlds/{w}/nodes/{id}
        GET /campaigns/{c}/locations           ->  GET /api/v1/worlds/{w}/nodes?template=location
        GET /campaigns/{c}/entities?types=..   ->  GET /api/v1/worlds/{w}/nodes?filter=...
        POST /campaigns/{c}/characters         ->  POST /api/v1/worlds/{w}/nodes
        entity posts                           ->  /api/v1/nodes/{id}/posts
        entity attributes                      ->  /api/v1/nodes/{id}/fields
        relations                              ->  /api/v1/relations
```

Keep from Kanka: `Authorization: Bearer`, paginated envelopes with `links`/`meta`,
`?related=1` style expansion, `lastSync` incremental fetch. Drop: one route per type.

## 6. Import plan (P1)

Source: campaign **BloodEarth**, id `376198`, via the Kanka API with a personal token.
The existing `mcp-kanka` setup proves the credentials and the SSL path already work.

Order matters, because references need their targets to exist:

1. **Campaign -> world.** Create the world, owner membership, and one Template per Kanka
   entity type.
2. **Entity shells.** Every entity as a node, recording `kanka_id` on each. Parents are
   left null on this pass.
3. **Re-parent.** Second pass sets `parent_id` from Kanka's parent columns, using the
   `kanka_id -> node_id` map. Detect and break cycles.
4. **Bodies.** HTML to Markdown (turndown), then rewrite Kanka mention syntax
   (`[entity:12345|Label]` and its per-type variants) into `[[wikilinks]]` via the ID map.
   Unresolvable mentions become plain text plus a warning in the import report.
5. **Posts**, preserving visibility per the table above. This is the DM-notes migration
   and it is the part to verify by hand afterwards.
6. **Attributes -> fields**, **tags**, **relations**.
7. **Calendars and events.** The calendar schema (months, weekdays, leap rules, moons,
   eras) converts to our JSON schema; each event becomes a dated node with `start_abs`
   computed by the calendar package. `TheOpenBin/07_DND/kanka_events.json` is a ready-made
   fixture for this — it already carries `lane` values for timeline rows.
8. **Images.** Download each entity image and header to `assets/`, content-hashed.
9. **Report.** Counts per type, unresolved mentions, skipped fields, visibility summary
   ("N posts imported as dm-only"). Import is idempotent: re-running updates by
   `kanka_id` rather than duplicating.

Treat the importer as a test harness, not a one-shot script. If a real campaign with
nested locations, hidden posts, custom attributes and a homebrew calendar round-trips
cleanly, the data model is sound. If it does not, better to learn that in P1 than in P5.
