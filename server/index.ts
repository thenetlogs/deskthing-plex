import { DeskThing } from "@deskthing/server";
import { DESKTHING_EVENTS, SongEvent, AUDIO_REQUESTS } from "@deskthing/types";
import {
  initSettings,
  getConfig,
  refreshConfig,
  setConnectionStatus,
  resetStatusCache,
} from "./settings";
import { fetchSessions, PlexError } from "./plexClient";
import { pickSession, toSongData } from "./sessionMapper";
import { makeThumbnailCache, downloadArt } from "./thumbnailCache";
import { setSong, clearSong, resendSong } from "./songStore";

// Safety nets: an unhandled rejection/exception in a worker thread is fatal by
// default in Node and would abort the whole DeskThing process. Log instead.
process.on("unhandledRejection", (e) => console.error("[plex] unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("[plex] uncaughtException:", e));

const cache = makeThumbnailCache(downloadArt);
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let currentInterval = 0;

const tick = async () => {
  if (inFlight) return; // skip if the previous poll is still running
  inFlight = true;
  try {
    let { url, token, target } = getConfig();
    if (!url || !token) {
      // Self-heal: the cached config may have missed a racy initial load (e.g.
      // right after an install/overwrite). Re-read once before giving up so the
      // app recovers without needing a manual restart or settings change.
      await refreshConfig();
      ({ url, token, target } = getConfig());
    }
    if (!url || !token) {
      setConnectionStatus("not configured");
      return;
    }
    const res = await fetchSessions(url, token);
    const session = pickSession(res, target);
    if (!session) {
      setConnectionStatus("no session");
      clearSong();
      return;
    }
    const song = toSongData(session);
    const thumbUrl = song.thumbnail ? `${url.replace(/\/$/, "")}${song.thumbnail}` : "";
    song.thumbnail = await cache.resolve(session.ratingKey ?? "", thumbUrl, token);
    setSong(song);
    setConnectionStatus("OK");
  } catch (e) {
    if (e instanceof PlexError && e.kind === "unauthorized") {
      setConnectionStatus("401 invalid token");
    } else {
      setConnectionStatus("unreachable");
    }
  } finally {
    inFlight = false;
  }
};

// (Re)start the interval only when the configured interval actually changed.
const ensureTimer = () => {
  const { interval } = getConfig();
  if (timer && interval === currentInterval) return;
  if (timer) clearInterval(timer);
  currentInterval = interval;
  timer = setInterval(() => void tick(), interval);
};

const start = async () => {
  try {
    await initSettings();
    ensureTimer();
    void tick();
    console.log("[plex] audio source started");
  } catch (e) {
    console.error("[plex] start failed:", e);
  }
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
  currentInterval = 0;
  resetStatusCache();
  console.log("[plex] audio source stopped");
};

DeskThing.on(DESKTHING_EVENTS.START, () => void start());
DeskThing.on(DESKTHING_EVENTS.STOP, () => stop());
DeskThing.on(DESKTHING_EVENTS.PURGE, () => {
  stop();
  clearSong();
});

// On settings change: refresh the cache and adjust the timer if the interval
// changed. We never write settings here, so our own connection_status writes
// can't create a feedback loop.
DeskThing.on(DESKTHING_EVENTS.SETTINGS, () => {
  void refreshConfig().then(ensureTimer);
});

// Answer client requests for the current song.
DeskThing.on(SongEvent.GET, (data: any) => {
  try {
    if (data?.request === AUDIO_REQUESTS.SONG || data?.request === AUDIO_REQUESTS.REFRESH) {
      resendSong();
    }
  } catch (e) {
    console.error("[plex] song GET failed:", e);
  }
});
