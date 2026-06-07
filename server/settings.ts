import { DeskThing } from "@deskthing/server";
import { SETTING_TYPES } from "@deskthing/types";

export type ConnStatus =
  | "OK"
  | "no session"
  | "401 invalid token"
  | "unreachable"
  | "not configured";

export interface PlexConfig {
  url: string;
  token: string;
  interval: number;
  target: string;
}

const DEFAULTS: PlexConfig = { url: "", token: "", interval: 2000, target: "" };
let cached: PlexConfig = { ...DEFAULTS };

const parse = (s: any): PlexConfig => ({
  url: (s?.plex_url?.value as string) ?? "",
  token: (s?.plex_token?.value as string) ?? "",
  interval: Math.max(1000, Number(s?.poll_interval?.value ?? 2000)),
  target: (s?.target?.value as string) ?? "",
});

export const initSettings = async () => {
  await DeskThing.initSettings({
    plex_url: { id: "plex_url", label: "Plex Server URL", type: SETTING_TYPES.STRING, value: "" },
    plex_token: { id: "plex_token", label: "Plex Token (X-Plex-Token)", type: SETTING_TYPES.STRING, value: "" },
    poll_interval: { id: "poll_interval", label: "Poll interval (ms)", type: SETTING_TYPES.NUMBER, value: 2000 },
    target: { id: "target", label: "Player filter (optional)", type: SETTING_TYPES.STRING, value: "" },
    connection_status: { id: "connection_status", label: "Connection status (read-only)", type: SETTING_TYPES.STRING, value: "not configured" },
  });
  await refreshConfig();
};

// Re-read settings from the server and update the in-memory cache. Wrapped so a
// failure can never reject into a fatal worker error.
export const refreshConfig = async () => {
  try {
    const s = await DeskThing.getSettings();
    if (s) cached = parse(s);
  } catch (e) {
    console.error("[plex] getSettings failed:", e);
  }
};

// Synchronous read of the cached config — no per-tick IPC.
export const getConfig = (): PlexConfig => cached;

let lastStatus: ConnStatus | "" = "";
export const resetStatusCache = () => {
  lastStatus = "";
};

// Fire-and-forget. Writing the status to settings is best-effort and must never
// throw or cascade — the SETTINGS event it triggers only refreshes the cache.
export const setConnectionStatus = (status: ConnStatus) => {
  if (status === lastStatus) return;
  lastStatus = status;
  console.log(`[plex] connection_status: ${status}`);
  DeskThing.setSettings({
    connection_status: { id: "connection_status", label: "Connection status (read-only)", type: SETTING_TYPES.STRING, value: status },
  }).catch((e) => console.error("[plex] setSettings(connection_status) failed:", e));
};
