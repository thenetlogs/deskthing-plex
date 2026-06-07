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
