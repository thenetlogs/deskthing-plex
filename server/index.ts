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
