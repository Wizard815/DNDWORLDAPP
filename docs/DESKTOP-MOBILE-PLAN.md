# DNDWORLDAPP — Desktop & Mobile App Plan

**Date:** 2026-09-27
**Status:** Design — ready to scaffold

## 1. Architecture Overview

### The one rule
Every client — web, desktop, mobile — is a thin API consumer. **DNDWORLDAPP's API is the single source of truth.** No client stores world data permanently. Clients cache for offline/readability; the server is the canonical store.

### Tech stack

| Platform | Framework | Rationale |
|----------|-----------|-----------|
| **Desktop (Linux-first)** | Tauri 2.x + React/TypeScript | Small binary (~15MB), native Linux packaging (.deb/.AppImage/.rpm), Rust for system access (audio, mic, keyring) |
| **Mobile (iOS/Android)** | Expo (React Native) | Single codebase for both platforms, shares React patterns with desktop, OTA updates, easy app store distribution |

### Shared layers

```
packages/dnd-client/          ← Shared API client + auth abstraction
apps/desktop/                 ← Tauri 2.x app (React + Rust)
apps/mobile/                  ← Expo React Native app
```

`dnd-client` is the one library both apps import. It provides:
- Typed API wrappers (reuses `@dndworldapp/schema` Zod types)
- Token storage abstraction (keyring on desktop, secure-store on mobile)
- Offline cache (SQLite on desktop, MMKV on mobile)
- SSE subscription hook (for realtime, future)

## 2. What the Desktop App Does (DM Companion, v1 scope)

### Must-have for v1 (Phase 1)
1. **Token login** — enter server URL + bearer token (generated from web app's sidebar)
2. **World picker** — list worlds from scoped token
3. **Node tree browser** — collapsible outline of all visible pages
4. **Node viewer** — render markdown with wiki links, DM notes, maps
5. **Map viewer** — read-only Leaflet map with markers, polygons, tokens
6. **Marker search** — search + jump-to any marker
7. **Soundboard** — play/stop audio pads (local file picker, layered playback)

### Nice-to-have for v1 (Phase 2, after v1 ships)
8. **Audio transcription** — faster-whisper (local), live captions for session audio
9. **MCP integration** — run DNDWORLDAPP MCP + dnd-oracle MCP as background processes
10. **Second-screen display** — send node content to separate window (player-facing), per `ttrpg-tools-screen` pattern
11. **Encounter builder** — dnd-oracle's `build_encounter`/`suggest_encounter` tools integrated into UI
12. **Live captions** — transcription results streamed to companion UI

### Explicitly out of scope for v1
- World authoring (use web app for that — desktop is companion, not replacement)
- Realtime co-editing (deliberately last per PLAN.md §7)
- Player-facing binary (player is a mode within desktop or mobile, not separate app per ROADMAP §1)

## 3. What the Mobile App Does (iOS/Android)

### Must-have for v1
1. **Token login** — enter server URL + bearer token
2. **World picker** — list worlds from scoped token
3. **Node list** — scrollable list of visible pages (optimized for phone)
4. **Node viewer** — render markdown, wiki links, maps (pinch/zoom)
5. **Quick search** — fuzzy search across all visible pages + markers
6. **Share link QR** — scan a share link to join a world read-only

### Nice-to-have (Phase 2)
7. **Quick capture** — camera/photo to attach to a node (from table)
8. **Offline reading** — cache recently viewed pages
9. **Initiative tracker** — read-only encounter view synced from desktop

### Key mobile considerations
- **Camera/mic permissions require HTTPS** — for local homelab, users need to either:
  - Use a self-signed cert + accept warning, OR
  - Use `http` with platform-specific exceptions (Android allows this, iOS more restrictive)
  - Recommendation: document both paths in app setup
- **No persistent world data** — mobile app is read-heavy, write-light
- **Push notifications** — future work (SSE → push gateway → mobile FCM/APNs)

## 4. Authentication Flow

### Desktop
1. User opens app → sees "Connect to DNDWORLDAPP" screen
2. Enter `http://homelab.local:8080` (or any reachable URL)
3. Enter bearer token (generated from web app sidebar, scoped to one world)
4. App validates token, stores in Linux keyring (secret-service via Rust crate)
5. Next launch: auto-retrieve from keyring

### Mobile
1. Same "Connect" screen
2. Enter server URL + bearer token
3. App validates, stores in `expo-secure-store`
4. Next launch: auto-retrieve

### Token scopes
- `world:read` — browse, view, search (player/desktop companion)
- `world:write` — create/edit nodes, markers (DM use, rare on mobile)
- `admin` — full access (owner only)

## 5. Offline / Cache Strategy

### Desktop
- SQLite local cache for recently viewed nodes (last 100 accessed)
- Cache entries: `id, title, body_md, kind, updated_at`
- TTL: 1 hour, or manual refresh from server
- Map tiles: cached as downloaded (same as web app)

### Mobile
- MMKV (in-memory key-value) for active session data
- SQLite for offline cache (react-native-sqlite-storage)
- Same schema as desktop, smaller TTL (30 min)
- "Offline mode" indicator in UI

## 6. Realtime / SSE (Future)

Roadmap §5 calls out SSE as the load-bearing gap for live-session features. Both desktop and mobile will need:

```
GET /api/v1/events?world=<id>&since=<timestamp>
```

Events stream: `node_updated`, `marker_updated`, `hp_changed`, etc.

Desktop app can use this for:
- Live transcription results streaming in
- Soundboard sync (if multiple devices)
- Player app watching state changes

Mobile app can use this for:
- Push notifications (future: SSE → push gateway → FCM/APNs)
- Initiative tracker sync

## 7. Implementation Order

### Phase 1 — Shared Client + Desktop MVP (6-8 weeks)
1. `packages/dnd-client/` — API client with auth, token storage abstraction
2. `apps/desktop/` — Tauri 2 scaffold, login flow, token storage
3. `apps/desktop/` — World picker + node tree browser
4. `apps/desktop/` — Node viewer (markdown rendering)
5. `apps/desktop/` — Map viewer (read-only Leaflet)
6. `apps/desktop/` — Soundboard (local audio files, layered playback)

### Phase 2 — Desktop Companion Features (4-6 weeks)
7. Audio transcription (faster-whisper, local)
8. MCP integration (DNDWORLDAPP MCP + dnd-oracle)
9. Second-screen display
10. Encounter builder UI

### Phase 3 — Mobile App (4-6 weeks)
11. `apps/mobile/` — Expo scaffold, shared dnd-client
12. Mobile login + world picker
13. Mobile node browser + viewer
14. Mobile search + QR scanner

### Phase 4 — Polish (ongoing)
15. Offline cache sync
16. Push notifications
17. App store submission

## 8. Dependencies & Prior Art

| Reference | What to copy | What to avoid |
|-----------|-------------|---------------|
| `apps/mcp/src/client.ts` | API client pattern, token auth, error handling | — |
| `dnd-oracle/` | MCP server for rules lookups (reuse wholesale) | Don't build own rules DB |
| `ttrpg-tools-screen/` | Player screen popout pattern | It's Obsidian-specific; adapt to Tauri window API |
| `chronicle/` | Mobile-first DM app structure, voice interaction | It's AI-storyteller focused; different feature set |
| `Log of Beholding/` | Local voice recognition, soundboard patterns | Windows-only; adapt to Linux (PulseAudio/ALSA) |

## 9. Build & Deploy

### Desktop
- **Build:** `npm run tauri build` → `.deb`, `.rpm`, `.AppImage`
- **Distribution:** GitHub releases + optional flathub
- **Auto-update:** Tauri update API (custom server) or manual download

### Mobile
- **Build:** `expo build:android` / `expo build:ios`
- **Distribution:** TestFlight (iOS), internal testing (Android)
- **OTA updates:** Expo EAS Update

## 10. Open Questions

1. **Should the desktop app also handle world authoring?** Roadmap says "companion" — but a DM might want quick edits at the table. Answer: no, not for v1. Web app handles authoring; desktop is read/companion.
2. **Single app or separate desktop/mobile?** Roadmap §1 says "three apps, one host" but §5 recommends "one app with mode toggle" for player app. Desktop and mobile are distinct enough to warrant separate apps (different UX patterns, different hardware capabilities).
3. **Should we share UI components between desktop and mobile?** Yes — use a shared component library in `packages/dnd-client/components/` (React for desktop, React Native compatible). But don't force it if the UX diverges too much.
4. **Linux-first for desktop:** Confirmed by roadmap. macOS/Windows are nice-to-have but not required for v1.
