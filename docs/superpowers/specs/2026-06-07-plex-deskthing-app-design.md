# DeskThing Plex Audio Source — Design Spec

Date: 2026-06-07
Status: Approved (design)

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
- Server-only audio source — no custom Car Thing client UI; the built-in DeskThing
  now-playing view (or VinylPlayer/clock) renders the data.
- Configuration via DeskThing app Settings (no hardcoded secrets).

**OUT (later):**
- Playback controls (play/pause/next/prev/seek) via Plex remote-control API.
- Plex websocket push updates (real-time) instead of polling.
- plex.tv account discovery / multi-server selection.

## Approach

Poll Plex Media Server `GET /status/sessions` with `X-Plex-Token`. Chosen over the
websocket notification API (`/:/websockets/notifications`) for MVP simplicity;
websocket is a documented future enhancement.

## Architecture

DeskThing app (TypeScript) using `@deskthing/server` + `@deskthing/cli`, built to a
zip and loaded into the DeskThing desktop server.

### Components

- **`manifest.json`** — `id: "plex"`, `label: "Plex"`, `isAudioSource: true`,
  `platforms: [windows, linux, mac]`, version pinned to DeskThing 0.11.x SDK.
- **`server/settings.ts`** — defines + reads app settings:
  - `plex_url` (string) — e.g. `http://192.168.x.x:32400`
  - `plex_token` (string) — `X-Plex-Token`
  - `poll_interval` (number, default `3000` ms)
  - `target` (string, optional) — player/product filter; empty = first music session
- **`server/plexClient.ts`** — `fetchSessions()` (GET `/status/sessions`,
  `Accept: application/json`, token); `pickSession(container, target)` — choose the
  relevant `Metadata`; pure, unit-testable parsing.
- **`server/songStore.ts`** — `toSongData(session)` mapper; holds current `SongData`;
  `sendUpdate()`; handles `SongEvent.GET` (`AUDIO_REQUESTS.SONG` / `REFRESH`).
- **`server/index.ts`** — lifecycle: `DESKTHING_EVENTS.START` (begin poll loop),
  `STOP`/`PURGE` (clear timer + state).

### Data flow

```
poll timer ──> plexClient.fetchSessions() ──> pickSession()
   ──> songStore.toSongData() ──> DeskThing.send(SongData) ──> Car Thing now-playing view
SongEvent.GET/REFRESH ──> songStore returns cached SongData
```

### Plex → SongData mapping

| SongData field | Plex source |
|-|-|
| title / track name | `Metadata.title` |
| artist | `Metadata.grandparentTitle` |
| album | `Metadata.parentTitle` |
| duration (ms) | `Metadata.duration` |
| position (ms) | `Metadata.viewOffset` |
| is_playing | `Metadata.Player.state === 'playing'` |
| thumbnail | `DeskThing.saveImageReferenceFromURL(`${plex_url}${thumb}?X-Plex-Token=${token}`)` |
| id | `Metadata.ratingKey` |

Session selection: filter `Metadata` to `type === 'track'`; if `target` set, match
`Player.title`/`Player.product`/`User.title`; prefer `Player.state === 'playing'`;
else first match.

## Error handling

- Missing `plex_url`/`plex_token` → log once, stay idle (no crash).
- Plex unreachable / network error → catch, log, retry on next poll.
- HTTP 401 → log clear "invalid token" message, retry next poll.
- No music session present → clear current song (send empty/stopped state).
- Thumbnail fetch failure → send track without art, do not block.

## Testing

- **Unit:** `pickSession()` + `toSongData()` against captured `/status/sessions`
  JSON fixtures (playing track, paused track, no session, multiple sessions).
- **Manual:** enter settings in DeskThing, play a track in Plexamp, confirm the
  Car Thing now-playing view shows correct title/artist/art/progress and pause state.

## Build & install

- Develop in `~/deskthing-plex/`.
- Build with `@deskthing/cli` → produces a loadable zip.
- Install via DeskThing desktop → Downloads → load from file; set as audio source
  (`music_playbackLocation`).

## Open items (deferred, not blocking MVP)

- Playback controls (`SongEvent.SET` → Plex `/player/playback/*` with
  `X-Plex-Target-Client-Identifier`; requires Plexamp remote control enabled).
- Websocket push updates.
- Multi-session UI / per-user filtering beyond the simple `target` setting.
