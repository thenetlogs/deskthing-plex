import { describe, it, expect, vi } from "vitest";
import { makeThumbnailCache } from "../thumbnailCache";

describe("thumbnailCache", () => {
  it("downloads once per track id and caches the served path", async () => {
    const download = vi.fn().mockResolvedValue("/resource/image/plex/101.png");
    const cache = makeThumbnailCache(download);
    const a = await cache.resolve("101", "http://plex/t1", "TOK");
    const b = await cache.resolve("101", "http://plex/t1", "TOK");
    expect(a).toBe("/resource/image/plex/101.png");
    expect(b).toBe("/resource/image/plex/101.png");
    expect(download).toHaveBeenCalledTimes(1);
  });
  it("re-downloads when track id changes", async () => {
    const download = vi.fn()
      .mockResolvedValueOnce("/resource/image/plex/101.png")
      .mockResolvedValueOnce("/resource/image/plex/102.png");
    const cache = makeThumbnailCache(download);
    await cache.resolve("101", "http://plex/t1", "TOK");
    const second = await cache.resolve("102", "http://plex/t2", "TOK");
    expect(second).toBe("/resource/image/plex/102.png");
    expect(download).toHaveBeenCalledTimes(2);
  });
  it("returns '' and does not throw when download fails", async () => {
    const download = vi.fn().mockRejectedValue(new Error("boom"));
    const cache = makeThumbnailCache(download);
    expect(await cache.resolve("101", "http://plex/t1", "TOK")).toBe("");
  });
  it("returns '' for empty url without downloading", async () => {
    const download = vi.fn();
    const cache = makeThumbnailCache(download);
    expect(await cache.resolve("101", "", "TOK")).toBe("");
    expect(download).not.toHaveBeenCalled();
  });
});
