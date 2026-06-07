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

// Reset the dedupe cache so the next setConnectionStatus always writes.
// Call on STOP/PURGE so a restart re-publishes the status even if unchanged.
export const resetStatusCache = () => {
  lastStatus = "";
};

export const setConnectionStatus = async (status: ConnStatus) => {
  if (status === lastStatus) return; // avoid redundant writes
  lastStatus = status;
  // Setter name verified in Task 1 Step 3:
  await DeskThing.setSettings({
    connection_status: { id: "connection_status", label: "Connection status (read-only)", type: SETTING_TYPES.STRING, value: status },
  });
};
