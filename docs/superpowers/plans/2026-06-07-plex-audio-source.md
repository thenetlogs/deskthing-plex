# Plex Audio Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DeskThing audio-source app that shows Plexamp now-playing on the Spotify Car Thing by polling the Plex Media Server HTTP API, bypassing the macOS 15.4+ MediaRemote lockdown.

**Architecture:** A TypeScript DeskThing app. A poll loop fetches `GET /status/sessions` from Plex, a **pure** mapper selects the music session and converts it to DeskThing `SongData`, an impure thumbnail cache downloads cover art (cached by track id), and `DeskThing.sendSong()` pushes the data to the built-in now-playing view. Settings (Plex URL/token/interval) are entered in the DeskThing UI.

**Tech Stack:** TypeScript, Node 18+ (global `fetch`), `@deskthing/server`, `@deskthing/client`, `@deskthing/cli`, `vitest` for unit tests.

**Reference implementations (read before coding):**
- `https://github.com/DannyTheHeretic/betterLocalAudioThing` — `server/imageUtils.ts` (image save → `/resource/image/<appId>/...`), `server/mediaStore.ts` (real `SongData` payload + `DeskThing.sendSong`), `server/initializer.ts` (`SongEvent` wiring), `deskthing/manifest.json`.
- Installed type defs after `npm install`: `node_modules/@deskthing/types/**/*.d.ts` (SongData, SETTING_TYPES, SongEvent, AUDIO_REQUESTS, DESKTHING_EVENTS) and `node_modules/@deskthing/server/**/*.d.ts` (`DeskThing.sendSong`, `initSettings`, settings setter).

---

## File Structure

```
deskthing/manifest.json     # app manifest (id "plex", tags:["audiosource"], requiredVersions)
package.json                # deps + scripts (dev/build/package/test)
tsconfig.json               # TS config for server
vitest.config.ts            # test runner config
index.html + src/main.tsx   # minimal client bundle (required by toolchain)
server/types.ts             # local Plex JSON types + app constants
server/settings.ts          # initSettings(), typed getters, connection-status updater
server/sessionMapper.ts     # PURE: pickSession(), toSongData()  ← unit-tested core
server/thumbnailCache.ts    # impure: download art (header auth), cache by ratingKey
server/plexClient.ts        # impure: fetch + JSON-parse /status/sessions
server/songStore.ts         # holds current SongData, sendSong(), GET/REFRESH handlers
server/index.ts             # lifecycle (START/STOP/PURGE) + poll loop + in-flight guard
server/__tests__/sessionMapper.test.ts
server/__tests__/thumbnailCache.test.ts
server/__tests__/fixtures/*.json
```

---

## Task 1: Scaffold project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `deskthing/manifest.json`, `index.html`, `src/main.tsx`, `server/types.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "deskthing-plex",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "deskthing dev",
    "build": "deskthing package",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@deskthing/server": "^0.11.6",
    "@deskthing/client": "^0.11.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@deskthing/cli": "^0.11.10",
    "@deskthing/types": "^0.11.16",
    "@types/node": "^22.10.7",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.19",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd ~/deskthing-plex && npm install`
Expected: `node_modules/` populated, no peer-dep errors that abort install.

- [ ] **Step 3: Verify the SDK surface against installed types**

Run:
```bash
grep -rl "sendSong" node_modules/@deskthing/server/dist/*.d.ts
grep -rn "export declare const SETTING_TYPES\|track_name\|interface SongData\|sendSong\|initSettings\|setSettings\|saveSettings" node_modules/@deskthing/server/dist/*.d.ts node_modules/@deskthing/types/dist/**/*.d.ts | head -40
```
Expected: confirms `SongData` fields, `SETTING_TYPES`, `DeskThing.sendSong`, `initSettings`, and the **settings setter name** (one of `setSettings`/`saveSettings`/`updateSetting` — note which exists; used in Task 3 & 8). If a name differs from this plan, prefer the installed type def.

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["server", "src"]
}
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { globals: true, environment: "node", include: ["server/**/*.test.ts"] },
});
```

- [ ] **Step 6: Create `deskthing/manifest.json`** (`isAudioSource` is deprecated — use `tags`)

```json
{
  "id": "plex",
  "label": "Plex",
  "version": "0.1.0",
  "description": "Now-playing from a Plex Media Server (Plexamp) via the Plex HTTP API.",
  "author": "Serhii Mukha",
  "requires": [],
  "tags": ["audiosource"],
  "requiredVersions": { "server": ">=0.11.13", "client": ">=0.11.2" },
  "platforms": ["windows", "linux", "mac", "mac64", "macarm", "arm64", "x64"]
}
```

- [ ] **Step 7: Create minimal client bundle** — the toolchain requires a client; the now-playing view is built-in, so this stays a stub.

`index.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8" /><title>Plex</title></head>
<body><div id="app">Plex audio source active.</div><script type="module" src="/src/main.tsx"></script></body></html>
```

`src/main.tsx`:
```tsx
// Minimal client stub. Rendering of now-playing is handled by DeskThing's built-in
// music view, which consumes the audio source. Nothing to render here.
export {};
```

- [ ] **Step 8: Create `server/types.ts`** (Plex JSON shapes + constants)

```ts
export const APP_ID = "plex";

export interface PlexPlayer {
  state?: string;            // "playing" | "paused" | "buffering"
  title?: string;
  product?: string;
  machineIdentifier?: string;
}
export interface PlexUser { title?: string }

export interface PlexMetadata {
  type?: string;             // "track" for music
  ratingKey?: string;
  title?: string;            // track name
  grandparentTitle?: string; // artist
  parentTitle?: string;      // album
  duration?: number;         // ms
  viewOffset?: number;       // ms (current position)
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  Player?: PlexPlayer;
  User?: PlexUser;
}
export interface PlexSessionsResponse {
  MediaContainer?: { size?: number; Metadata?: PlexMetadata[] };
}
```

- [ ] **Step 9: Commit**

```bash
cd ~/deskthing-plex
git add -A
git commit -m "chore: scaffold deskthing-plex app (manifest, tsconfig, vitest, types)"
```

---

## Task 2: Pure `pickSession()`

**Files:**
- Create: `server/sessionMapper.ts`
- Test: `server/__tests__/sessionMapper.test.ts`, `server/__tests__/fixtures/playing.json`, `paused.json`, `none.json`, `multi.json`, `nontrack.json`

- [ ] **Step 1: Create fixtures**

`server/__tests__/fixtures/playing.json`:
```json
{ "MediaContainer": { "size": 1, "Metadata": [
  { "type": "track", "ratingKey": "101", "title": "Beautiful Day", "grandparentTitle": "U2", "parentTitle": "All That You Can't Leave Behind", "duration": 248066, "viewOffset": 42000, "thumb": "/library/metadata/101/thumb/1", "Player": { "state": "playing", "title": "Plexamp", "product": "Plexamp", "machineIdentifier": "aaa" }, "User": { "title": "serhii" } }
] } }
```

`server/__tests__/fixtures/paused.json`:
```json
{ "MediaContainer": { "size": 1, "Metadata": [
  { "type": "track", "ratingKey": "102", "title": "One", "grandparentTitle": "U2", "parentTitle": "Achtung Baby", "duration": 276000, "viewOffset": 1000, "thumb": "/library/metadata/102/thumb/1", "Player": { "state": "paused", "product": "Plexamp", "machineIdentifier": "bbb" } }
] } }
```

`server/__tests__/fixtures/none.json`:
```json
{ "MediaContainer": { "size": 0 } }
```

`server/__tests__/fixtures/multi.json`:
```json
{ "MediaContainer": { "size": 2, "Metadata": [
  { "type": "track", "ratingKey": "201", "title": "B-side", "grandparentTitle": "Artist Z", "parentTitle": "Z", "duration": 100000, "viewOffset": 5000, "Player": { "state": "playing", "product": "Plexamp", "machineIdentifier": "zzz" } },
  { "type": "track", "ratingKey": "202", "title": "A-side", "grandparentTitle": "Artist A", "parentTitle": "A", "duration": 100000, "viewOffset": 5000, "Player": { "state": "playing", "product": "Plexamp", "machineIdentifier": "aaa" } }
] } }
```

`server/__tests__/fixtures/nontrack.json`:
```json
{ "MediaContainer": { "size": 1, "Metadata": [
  { "type": "episode", "ratingKey": "301", "title": "Some Show", "Player": { "state": "playing", "machineIdentifier": "ccc" } }
] } }
```

- [ ] **Step 2: Write failing test for `pickSession`**

`server/__tests__/sessionMapper.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pickSession } from "../sessionMapper";
import playing from "./fixtures/playing.json";
import none from "./fixtures/none.json";
import multi from "./fixtures/multi.json";
import nontrack from "./fixtures/nontrack.json";

describe("pickSession", () => {
  it("returns the only playing track", () => {
    expect(pickSession(playing, "")?.ratingKey).toBe("101");
  });
  it("returns null when no sessions", () => {
    expect(pickSession(none, "")).toBeNull();
  });
  it("ignores non-track media", () => {
    expect(pickSession(nontrack, "")).toBeNull();
  });
  it("is deterministic with multiple playing tracks (stable sort by machineIdentifier)", () => {
    expect(pickSession(multi, "")?.ratingKey).toBe("202"); // aaa < zzz
  });
  it("honors target filter (case-insensitive contains)", () => {
    expect(pickSession(multi, "Artist A")?.ratingKey).toBe("202");
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npm test -- sessionMapper`
Expected: FAIL — `pickSession` not exported.

- [ ] **Step 4: Implement `pickSession`**

`server/sessionMapper.ts`:
```ts
import type { PlexMetadata, PlexSessionsResponse } from "./types";

const matchesTarget = (m: PlexMetadata, target: string): boolean => {
  if (!target) return true;
  const t = target.toLowerCase();
  const hay = [m.Player?.title, m.Player?.product, m.User?.title, m.grandparentTitle, m.title]
    .filter(Boolean)
    .map((s) => s!.toLowerCase());
  return hay.some((h) => h.includes(t));
};

export const pickSession = (
  res: PlexSessionsResponse,
  target: string
): PlexMetadata | null => {
  const all = res.MediaContainer?.Metadata ?? [];
  const tracks = all.filter((m) => m.type === "track" && matchesTarget(m, target));
  if (tracks.length === 0) return null;
  const sorted = [...tracks].sort((a, b) =>
    (a.Player?.machineIdentifier ?? "").localeCompare(b.Player?.machineIdentifier ?? "")
  );
  const playing = sorted.find((m) => m.Player?.state === "playing");
  return playing ?? sorted[0];
};
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npm test -- sessionMapper`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: pure pickSession with deterministic tiebreak and target filter"
```

---

## Task 3: Pure `toSongData()`

**Files:**
- Modify: `server/sessionMapper.ts`
- Test: `server/__tests__/sessionMapper.test.ts`

- [ ] **Step 1: Add failing tests for `toSongData`**

Append to `server/__tests__/sessionMapper.test.ts`:
```ts
import { toSongData, EMPTY_SONG } from "../sessionMapper";
import paused from "./fixtures/paused.json";
import { pickSession as pick } from "../sessionMapper";

describe("toSongData", () => {
  it("maps a playing track to SongData (thumbnail = raw thumb path)", () => {
    const s = pick(playing, "")!;
    const song = toSongData(s);
    expect(song.track_name).toBe("Beautiful Day");
    expect(song.artist).toBe("U2");
    expect(song.album).toBe("All That You Can't Leave Behind");
    expect(song.track_duration).toBe(248066);
    expect(song.track_progress).toBe(42000);
    expect(song.is_playing).toBe(true);
    expect(song.id).toBe("101");
    expect(song.version).toBe(2);
    expect(song.source).toBe("plex");
    expect(song.thumbnail).toBe("/library/metadata/101/thumb/1");
  });
  it("marks paused tracks as not playing", () => {
    const song = toSongData(pick(paused, "")!);
    expect(song.is_playing).toBe(false);
  });
  it("tolerates missing fields", () => {
    const song = toSongData({ type: "track", ratingKey: "9" });
    expect(song.track_name).toBe("");
    expect(song.artist).toBe("");
    expect(song.thumbnail).toBe("");
    expect(song.track_duration).toBe(0);
  });
  it("EMPTY_SONG is a cleared, not-playing payload", () => {
    expect(EMPTY_SONG.is_playing).toBe(false);
    expect(EMPTY_SONG.track_name).toBe("");
    expect(EMPTY_SONG.version).toBe(2);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- sessionMapper`
Expected: FAIL — `toSongData`/`EMPTY_SONG` not exported.

- [ ] **Step 3: Implement `toSongData` + `EMPTY_SONG`**

Append to `server/sessionMapper.ts`:
```ts
import type { SongData } from "@deskthing/types";

const pickThumb = (m: PlexMetadata): string =>
  m.thumb ?? m.parentThumb ?? m.grandparentThumb ?? "";

export const EMPTY_SONG: SongData = {
  version: 2,
  source: "plex",
  track_name: "",
  artist: "",
  album: "",
  thumbnail: "",
  track_duration: 0,
  track_progress: 0,
  is_playing: false,
  abilities: [],
  volume: 0,
  shuffle_state: null,
  repeat_state: "off",
  playlist: null,
  playlist_id: null,
  device: null,
  device_id: null,
  id: null,
};

// PURE: thumbnail is the raw Plex thumb path (resolved to a served URL elsewhere).
export const toSongData = (m: PlexMetadata): SongData => ({
  ...EMPTY_SONG,
  track_name: m.title ?? "",
  artist: m.grandparentTitle ?? "",
  album: m.parentTitle ?? "",
  thumbnail: pickThumb(m),
  track_duration: m.duration ?? 0,
  track_progress: m.viewOffset ?? 0,
  is_playing: m.Player?.state === "playing",
  id: m.ratingKey ?? null,
});
```

Note: if `npm test` in Step 1 of Task 1 revealed different `SongData` field names/required keys, adjust `EMPTY_SONG` to match the installed `@deskthing/types` def (keep the test assertions in sync).

- [ ] **Step 4: Run test, verify it passes**

Run: `npm test -- sessionMapper`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: pure toSongData mapper + EMPTY_SONG cleared state"
```

---

## Task 4: Plex client (`fetchSessions`)

**Files:**
- Create: `server/plexClient.ts`
- Test: `server/__tests__/plexClient.test.ts`

- [ ] **Step 1: Write failing test (mocked `fetch`)**

`server/__tests__/plexClient.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchSessions, PlexError } from "../plexClient";
import playing from "./fixtures/playing.json";

beforeEach(() => vi.restoreAllMocks());

describe("fetchSessions", () => {
  it("requests /status/sessions with token header + json accept", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(playing), { status: 200 })
    );
    const res = await fetchSessions("http://plex:32400", "TOK");
    expect(res.MediaContainer?.Metadata?.[0].ratingKey).toBe("101");
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe("http://plex:32400/status/sessions");
    expect((init as any).headers["X-Plex-Token"]).toBe("TOK");
    expect((init as any).headers["Accept"]).toBe("application/json");
  });
  it("throws PlexError('unauthorized') on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    await expect(fetchSessions("http://plex:32400", "BAD")).rejects.toMatchObject({ kind: "unauthorized" });
  });
  it("throws PlexError('unreachable') on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fetchSessions("http://plex:32400", "TOK")).rejects.toMatchObject({ kind: "unreachable" });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- plexClient`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `plexClient.ts`**

```ts
import type { PlexSessionsResponse } from "./types";

export type PlexErrorKind = "unauthorized" | "unreachable";
export class PlexError extends Error {
  constructor(public kind: PlexErrorKind, message: string) {
    super(message);
  }
}

export const fetchSessions = async (
  baseUrl: string,
  token: string
): Promise<PlexSessionsResponse> => {
  const url = `${baseUrl.replace(/\/$/, "")}/status/sessions`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "X-Plex-Token": token, Accept: "application/json" },
    });
  } catch (e) {
    throw new PlexError("unreachable", e instanceof Error ? e.message : "network error");
  }
  if (res.status === 401) throw new PlexError("unauthorized", "invalid Plex token");
  if (!res.ok) throw new PlexError("unreachable", `HTTP ${res.status}`);
  return (await res.json()) as PlexSessionsResponse;
};
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm test -- plexClient`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: plexClient.fetchSessions with token header + typed errors"
```

---

## Task 5: Thumbnail cache

**Files:**
- Create: `server/thumbnailCache.ts`
- Test: `server/__tests__/thumbnailCache.test.ts`

The cache exposes `resolve(ratingKey, absoluteThumbUrl, token, deps)` where `deps` are
injected for testing (download + save). It downloads only when `ratingKey` changes.

- [ ] **Step 1: Write failing test (injected deps, no real I/O)**

`server/__tests__/thumbnailCache.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { makeThumbnailCache } from "../thumbnailCache";

describe("thumbnailCache", () => {
  it("downloads once per track id and caches the served path", async () => {
    const download = vi.fn().mockResolvedValue("/resource/image/plex/101.png");
    const cache = makeThumbnailCache(download);
    const a = await cache.resolve("101", "http://plex/t1", "TOK");
    const b = await cache.resolve("101", "http://plex/t1", "TOK");
    expect(a).toBe("/resource/image/plex/101.png");
    expect(b).toBe("/resource/image/plex/101.png");
    expect(download).toHaveBeenCalledTimes(1);
  });
  it("re-downloads when track id changes", async () => {
    const download = vi.fn()
      .mockResolvedValueOnce("/resource/image/plex/101.png")
      .mockResolvedValueOnce("/resource/image/plex/102.png");
    const cache = makeThumbnailCache(download);
    await cache.resolve("101", "http://plex/t1", "TOK");
    const second = await cache.resolve("102", "http://plex/t2", "TOK");
    expect(second).toBe("/resource/image/plex/102.png");
    expect(download).toHaveBeenCalledTimes(2);
  });
  it("returns '' and does not throw when download fails", async () => {
    const download = vi.fn().mockRejectedValue(new Error("boom"));
    const cache = makeThumbnailCache(download);
    expect(await cache.resolve("101", "http://plex/t1", "TOK")).toBe("");
  });
  it("returns '' for empty url without downloading", async () => {
    const download = vi.fn();
    const cache = makeThumbnailCache(download);
    expect(await cache.resolve("101", "", "TOK")).toBe("");
    expect(download).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- thumbnailCache`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `thumbnailCache.ts`** (download helper uses header auth → no token in URL/path)

```ts
import { existsSync, mkdirSync, writeFile } from "node:fs";
import { join } from "node:path";
import { APP_ID } from "./types";

export type DownloadFn = (
  url: string,
  token: string,
  ratingKey: string
) => Promise<string>; // returns served path like /resource/image/plex/<id>.png

// Real downloader: GET art with token in header, write to the app's images dir.
export const downloadArt: DownloadFn = async (url, token, ratingKey) => {
  const imagesDir = join(__dirname, "../images");
  if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });
  const res = await fetch(url, { headers: { "X-Plex-Token": token } });
  if (!res.ok) throw new Error(`art HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = join(imagesDir, `${ratingKey}.png`);
  await new Promise<void>((resolve, reject) =>
    writeFile(file, buf, (err) => (err ? reject(err) : resolve()))
  );
  return `/resource/image/${APP_ID}/${ratingKey}.png`;
};

export const makeThumbnailCache = (download: DownloadFn) => {
  let lastKey = "";
  let lastPath = "";
  return {
    resolve: async (ratingKey: string, url: string, token: string): Promise<string> => {
      if (!url) return "";
      if (ratingKey && ratingKey === lastKey && lastPath) return lastPath;
      try {
        const path = await download(url, token, ratingKey || "art");
        lastKey = ratingKey;
        lastPath = path;
        return path;
      } catch {
        return "";
      }
    },
  };
};
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npm test -- thumbnailCache`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: thumbnailCache (download by header auth, cached by ratingKey)"
```

---

## Task 6: Settings module

**Files:**
- Create: `server/settings.ts`

Settings are SDK-coupled; this task wires `initSettings` and typed getters. Use the
setter name confirmed in Task 1 Step 3 (`setSettings`/`saveSettings`/`updateSetting`).

- [ ] **Step 1: Implement `server/settings.ts`**

```ts
import { DeskThing } from "@deskthing/server";
import { SETTING_TYPES } from "@deskthing/types";

export type ConnStatus =
  | "OK"
  | "no session"
  | "401 invalid token"
  | "unreachable"
  | "not configured";

export const initSettings = async () => {
  await DeskThing.initSettings({
    plex_url: { id: "plex_url", label: "Plex Server URL", type: SETTING_TYPES.STRING, value: "" },
    plex_token: { id: "plex_token", label: "Plex Token (X-Plex-Token)", type: SETTING_TYPES.STRING, value: "" },
    poll_interval: { id: "poll_interval", label: "Poll interval (ms)", type: SETTING_TYPES.NUMBER, value: 2000 },
    target: { id: "target", label: "Player filter (optional)", type: SETTING_TYPES.STRING, value: "" },
    connection_status: { id: "connection_status", label: "Connection status (read-only)", type: SETTING_TYPES.STRING, value: "not configured" },
  });
};

export const getConfig = async () => {
  const s = await DeskThing.getSettings();
  return {
    url: (s?.plex_url?.value as string) ?? "",
    token: (s?.plex_token?.value as string) ?? "",
    interval: Math.max(1000, Number(s?.poll_interval?.value ?? 2000)),
    target: (s?.target?.value as string) ?? "",
  };
};

let lastStatus: ConnStatus | "" = "";
export const setConnectionStatus = async (status: ConnStatus) => {
  if (status === lastStatus) return; // avoid redundant writes
  lastStatus = status;
  // Setter name verified in Task 1 Step 3:
  await DeskThing.setSettings({
    connection_status: { id: "connection_status", label: "Connection status (read-only)", type: SETTING_TYPES.STRING, value: status },
  });
};
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (if `getSettings`/`setSettings` names differ, fix to the verified names).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: settings (plex url/token/interval/target + connection status)"
```

---

## Task 7: Song store

**Files:**
- Create: `server/songStore.ts`

Holds the current `SongData`, sends it, and answers `SongEvent.GET` / `REFRESH`.

- [ ] **Step 1: Implement `server/songStore.ts`**

```ts
import { DeskThing } from "@deskthing/server";
import type { SongData } from "@deskthing/types";
import { EMPTY_SONG } from "./sessionMapper";

let current: SongData = EMPTY_SONG;

export const setSong = (song: SongData) => {
  current = song;
  DeskThing.sendSong(current);
};

export const clearSong = () => setSong(EMPTY_SONG);

export const resendSong = () => DeskThing.sendSong(current);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors (confirm `DeskThing.sendSong` exists per Task 1 Step 3).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: songStore (current SongData + sendSong/resend/clear)"
```

---

## Task 8: Lifecycle + poll loop (`index.ts`)

**Files:**
- Create: `server/index.ts`

- [ ] **Step 1: Implement `server/index.ts`**

```ts
import { DeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SongEvent, AUDIO_REQUESTS } from "@deskthing/types";
import { initSettings, getConfig, setConnectionStatus } from "./settings";
import { fetchSessions, PlexError } from "./plexClient";
import { pickSession, toSongData } from "./sessionMapper";
import { makeThumbnailCache, downloadArt } from "./thumbnailCache";
import { setSong, clearSong, resendSong } from "./songStore";

const cache = makeThumbnailCache(downloadArt);
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

const tick = async () => {
  if (inFlight) return; // in-flight guard: skip if previous still running
  inFlight = true;
  try {
    const { url, token, target } = await getConfig();
    if (!url || !token) {
      await setConnectionStatus("not configured");
      return;
    }
    const res = await fetchSessions(url, token);
    const session = pickSession(res, target);
    if (!session) {
      await setConnectionStatus("no session");
      clearSong();
      return;
    }
    const song = toSongData(session);
    const thumbUrl = song.thumbnail
      ? `${url.replace(/\/$/, "")}${song.thumbnail}`
      : "";
    song.thumbnail = await cache.resolve(session.ratingKey ?? "", thumbUrl, token);
    setSong(song);
    await setConnectionStatus("OK");
  } catch (e) {
    if (e instanceof PlexError && e.kind === "unauthorized") {
      await setConnectionStatus("401 invalid token");
    } else {
      await setConnectionStatus("unreachable");
    }
  } finally {
    inFlight = false;
  }
};

const startLoop = async () => {
  const { interval } = await getConfig();
  if (timer) clearInterval(timer);
  timer = setInterval(tick, interval);
  tick();
};

const start = async () => {
  await initSettings();
  await startLoop();
  console.log("Plex audio source started");
};

const stop = async () => {
  if (timer) clearInterval(timer);
  timer = null;
  console.log("Plex audio source stopped");
};

const purge = async () => {
  await stop();
  clearSong();
};

DeskThing.on(DESKTHING_EVENTS.START, start);
DeskThing.on(DESKTHING_EVENTS.STOP, stop);
DeskThing.on(DESKTHING_EVENTS.PURGE, purge);

// Re-read interval and restart the loop when settings change.
DeskThing.on(DESKTHING_EVENTS.SETTINGS, () => startLoop());

// Answer client requests for the current song.
DeskThing.on(SongEvent.GET, (data) => {
  if (data.request === AUDIO_REQUESTS.SONG || data.request === AUDIO_REQUESTS.REFRESH) {
    resendSong();
  }
});
```

- [ ] **Step 2: Type-check the whole server**

Run: `npx tsc --noEmit`
Expected: no errors. If `DESKTHING_EVENTS.SETTINGS` name differs, use the verified event name from `@deskthing/types`.

- [ ] **Step 3: Run all unit tests**

Run: `npm test`
Expected: PASS (Tasks 2–5 suites, ~16 tests).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: lifecycle + poll loop (in-flight guard, status, thumbnail resolve)"
```

---

## Task 9: Build, package, manual verification

**Files:** none (build + manual test)

- [ ] **Step 1: Build the package**

Run: `npm run build`
Expected: a zip is produced (e.g. `dist/plex-v0.1.0.zip` or as the CLI reports). Note the path.

- [ ] **Step 2: Load into DeskThing**

In the DeskThing desktop app → Downloads → load the zip from file. Enable the app.

- [ ] **Step 3: Configure settings**

In the app's settings, set `Plex Server URL` (e.g. `http://<plex-ip>:32400`) and
`Plex Token`. Leave interval `2000`. Confirm `connection_status` shows `OK` (or
`no session` if nothing is playing; `401 invalid token` proves the error path).

- [ ] **Step 4: Select as audio source + verify on device**

Set the app as the audio source. Play a **server-streamed** track in Plexamp.
Expected on the Car Thing now-playing view: correct title/artist/album, cover art,
a smooth (interpolating) progress bar, and correct pause state when paused.

- [ ] **Step 5: Verify stopped state**

Stop Plexamp playback. Expected: `connection_status` → `no session`, the view clears
(no stale track).

- [ ] **Step 6: Final commit / tag**

```bash
git add -A
git commit -m "docs: mark MVP verified" --allow-empty
git tag v0.1.0
```

---

## Self-Review (completed)

- **Spec coverage:** read-only now-playing (Tasks 2–3, 7–8), Plex polling (Task 4),
  thumbnail cache by id + header auth (Task 5), settings + connection status (Task 6),
  deterministic session pick + stopped state (Tasks 2–3, 8), in-flight guard + error
  handling (Task 8), manifest `tags`/`requiredVersions` + minimal client (Task 1),
  build/install + manual test incl. offline caveat awareness (Task 9). All covered.
- **Placeholders:** none — every code step has full code; SDK-name uncertainties are
  resolved by an explicit verification step (Task 1 Step 3) rather than left vague.
- **Type consistency:** `pickSession`/`toSongData`/`EMPTY_SONG`, `fetchSessions`/
  `PlexError`, `makeThumbnailCache`/`downloadArt`/`resolve(ratingKey,url,token)`,
  `setSong`/`clearSong`/`resendSong`, `getConfig`/`setConnectionStatus` are used
  consistently across tasks.
```
