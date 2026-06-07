# DeskThing Plex Audio Source — Design Spec

Date: 2026-06-07
Status: Approved design, revised after cross-review

## Problem

DeskThing's "Local Audio" app reads macOS now-playing via the private `MediaRemote`
framework (native module `node-nowplaying@0.1.0`). Apple locked MediaRemote to
entitled Apple processes starting **macOS 15.4**; on this machine (**macOS 26.5.1**)
the app polls without error but always returns empty. The library has no fix
(only v0.1.0, published 2025-03-27, before the lockdown), and every DeskThing
local-audio app depends on it. Therefore Plexamp tracks never appear on the Car Thing.

## Goal

A DeskThing **audio-source app** that reads now-playing from the **Plex Media Server
HTTP API** instead of the OS, fully bypassing MediaRemote. Works on any host OS.

## Scope

**IN (MVP):**
- Read-only now-playing: track title, artist, album, cover art, duration, position, play/pause state.
- Position interpolation anchor (`timestamp`) so the client progress bar is smooth between polls.
- Thumbnail cached by track id (fetched only when the track changes).
- Configuration via DeskThing app Settings (no hardcoded secrets) + a read-only
  connection-status field for diagnosability.
- A minimal client bundle (required by the toolchain); actual now-playing rendering
  is done by DeskThing's built-in music view, which consumes the audio source.

**OUT (later):**
- Playback controls (play/pause/next/prev/seek) via Plex remote-control API.
- Plex websocket push updates (real-time) instead of polling.
- plex.tv account discovery / multi-server selection.
- HTTPS to a Plex server with self-signed / `*.plex.direct` certs (MVP assumes `http://LAN:32400`).

**Known caveat (documented, not fixed):** Plexamp playing **offline/downloaded/cached**
content plays locally and does **not** create a server session, so it will not appear
in `/status/sessions`. Only server-streamed playback surfaces.

## Approach

Poll Plex Media Server `GET /status/sessions` with `X-Plex-Token`. Chosen over the
websocket notification API (`/:/websockets/notifications`) for MVP simplicity;
websocket is a documented future enhancement.

## Architecture

DeskThing app (TypeScript) using `@deskthing/server` + `@deskthing/client` +
`@deskthing/cli`, built to a zip and loaded into the DeskThing desktop server.

### Package layout

```
deskthing/manifest.json     # app manifest (see below)
server/index.ts             # lifecycle + poll loop
server/settings.ts          # initSettings + typed getters
server/plexClient.ts        # fetch + parse /status/sessions (impure: network)
server/sessionMapper.ts     # PURE: pickSession() + toSongData()  (unit-tested)
server/thumbnailCache.ts    # impure: download art (header auth) -> /resource/image path, cached by ratingKey
server/songStore.ts         # holds current SongData, sendSong(), SongEvent.GET/REFRESH
src/ + index.html           # minimal client bundle (Vite + @deskthing/client)
```

### manifest.json (corrected — `isAudioSource` is deprecated)

```json
{
  "id": "plex",
  "label": "Plex",
  "version": "0.1.0",
  "requires": [],
  "tags": ["audiosource"],
  "requiredVersions": { "server": ">=0.11.13", "client": ">=0.11.2" },
  "platforms": ["windows", "linux", "mac", "mac64", "macarm", "arm64", "x64"]
}
```

### Settings (`DeskThing.initSettings` + `SETTING_TYPES.*`)

- `plex_url` — `SETTING_TYPES.STRING`, e.g. `http://192.168.x.x:32400`
- `plex_token` — `SETTING_TYPES.STRING` (`X-Plex-Token`)
- `poll_interval` — `SETTING_TYPES.NUMBER`, default `2000` ms
- `target` — `SETTING_TYPES.STRING`, optional player/product/user filter; empty = auto-pick
- `connection_status` — `SETTING_TYPES.STRING`, read-only/disabled label updated each
  poll (`OK` / `401 invalid token` / `unreachable` / `no session`) for diagnosability

Settings are read via `getSettings()` and re-read on the `settings` event (no restart
needed); the poll loop picks up new values on the next tick.

### Data flow

```
poll timer (in-flight guard) ──> plexClient.fetchSessions()  [header: X-Plex-Token, Accept: json]
   ──> sessionMapper.pickSession(container, target)          [PURE]
   ──> sessionMapper.toSongData(session, fetchedAtMs)        [PURE, thumbnail=raw thumb path or null]
   ──> thumbnailCache.resolve(ratingKey, thumbUrl)           [impure, only if track changed]
   ──> songStore.sendSong(SongData)                          ──> built-in now-playing view
SongEvent.GET / REFRESH ──> songStore returns cached SongData
```

### Plex → SongData mapping (corrected field names)

| SongData field | Plex source |
|-|-|
| `track_name` | `Metadata.title` |
| `artist` | `Metadata.grandparentTitle` |
| `album` | `Metadata.parentTitle` |
| `track_duration` (ms) | `Metadata.duration` |
| `track_progress` (ms) | `Metadata.viewOffset` |
| `is_playing` | `Metadata.Player.state === 'playing'` |
| `timestamp` | `fetchedAtMs` (wall clock at fetch) — client interpolates progress |
| `thumbnail` | `thumbnailCache.resolve(...)` → `/resource/image/plex/<ratingKey>.png` |
| `id` | `Metadata.ratingKey` |
| `version` | `2` (required) |
| `source` | `"plex"` |
| `abilities` | `[]` (MVP read-only) |

Other required `SongData` fields (`volume`, `shuffle_state`, `repeat_state`,
`playlist`, `playlist_id`, `device`, `device_id`) are populated with neutral defaults.

### Session selection (deterministic)

1. Keep `Metadata` where `type === 'track'`.
2. If `target` non-empty, keep where `Player.title`/`Player.product`/`User.title`
   matches (case-insensitive contains).
3. Prefer `Player.state === 'playing'`.
4. **Deterministic tiebreak:** stable sort by `Player.machineIdentifier`, take first.
   (Avoids ping-pong between two concurrent streams. Empty `target` is documented as
   unreliable with 2+ simultaneous music streams.)

### Stopped / empty state (defined)

When no matching track session is found: send a cleared `SongData`
(`track_name: ""`, `artist: ""`, `album: ""`, `thumbnail: ""`, `track_duration: 0`,
`track_progress: 0`, `is_playing: false`, `version: 2`, `source: "plex"`) and set
`connection_status` to `no session`. The built-in view then shows its idle state.

## Thumbnail handling

- `thumbnailCache.resolve(ratingKey, thumbPath)`: if `ratingKey` matches the last
  resolved track, return the cached `/resource/image/plex/<ratingKey>.png` path
  without re-downloading.
- On change: GET `${plex_url}${thumbPath}` with `X-Plex-Token` in the **request header**
  (not the URL) to avoid leaking the token into the saved path/logs; write to the app's
  resource dir; return the `/resource/image/...` reference.
- On fetch failure: return `""` (send track without art); never block the song update.

## Error handling

- Missing `plex_url`/`plex_token` → set `connection_status = "not configured"`, stay idle.
- Network error / unreachable → catch, `connection_status = "unreachable"`, retry next tick.
- HTTP 401 → `connection_status = "401 invalid token"`, retry next tick.
- A thrown error in one tick must **not** kill the timer (wrap each tick in try/catch).
- **In-flight guard:** skip a tick if the previous fetch hasn't returned (prevents
  request pileup on a slow server).

## Testing

- **Unit (pure `sessionMapper`):** fixtures for — playing track, paused track, no
  session, multiple simultaneous sessions (tiebreak), **401 error body**,
  **malformed/partial Metadata** (missing `grandparentTitle`/`thumb`/`Player`),
  **non-track media** (video/podcast filtered out).
- **Manual:** enter settings in DeskThing, play a *server-streamed* track in Plexamp,
  confirm the Car Thing now-playing view shows correct title/artist/art, a smooth
  progress bar, and correct pause state; confirm `connection_status` reflects bad token.

## Build & install

- Develop in `~/deskthing-plex/`.
- Build with `@deskthing/cli package` → produces `plex-v0.1.0.zip`.
- Install via DeskThing desktop → Downloads → load from file; select as audio source.

## Open items (deferred, not blocking MVP)

- Playback controls (`SongEvent.SET` → Plex `/player/playback/*` with
  `X-Plex-Target-Client-Identifier`; requires Plexamp remote control enabled).
- Websocket push updates.
- HTTPS / self-signed cert support.
- Richer multi-session / per-user selection beyond the simple `target` setting.
