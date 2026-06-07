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
