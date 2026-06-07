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
