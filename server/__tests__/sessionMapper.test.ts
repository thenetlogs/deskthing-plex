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
