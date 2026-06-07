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
