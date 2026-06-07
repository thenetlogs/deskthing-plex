import type { PlexMetadata, PlexSessionsResponse } from "./types";
import type { SongData, SongData11 } from "@deskthing/types";

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

const pickThumb = (m: PlexMetadata): string =>
  m.thumb ?? m.parentThumb ?? m.grandparentThumb ?? "";

export const EMPTY_SONG: SongData11 = {
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
export const toSongData = (m: PlexMetadata): SongData11 => ({
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
