import { existsSync, mkdirSync, writeFile } from "node:fs";
import { join } from "node:path";
import { APP_ID } from "./types";

export type DownloadFn = (
  url: string,
  token: string,
  ratingKey: string
) => Promise<string>; // returns served path like /resource/image/plex/<id>.png

// Real downloader: GET art with token in header, write to the app's images dir.
export const downloadArt: DownloadFn = async (url, token, ratingKey) => {
  const imagesDir = join(__dirname, "../images");
  if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });
  const res = await fetch(url, { headers: { "X-Plex-Token": token } });
  if (!res.ok) throw new Error(`art HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = join(imagesDir, `${ratingKey}.png`);
  await new Promise<void>((resolve, reject) =>
    writeFile(file, buf, (err) => (err ? reject(err) : resolve()))
  );
  return `/resource/image/${APP_ID}/${ratingKey}.png`;
};

export const makeThumbnailCache = (download: DownloadFn) => {
  let lastKey = "";
  let lastPath = "";
  return {
    resolve: async (ratingKey: string, url: string, token: string): Promise<string> => {
      if (!url) return "";
      if (ratingKey && ratingKey === lastKey && lastPath) return lastPath;
      try {
        const path = await download(url, token, ratingKey || "art");
        lastKey = ratingKey;
        lastPath = path;
        return path;
      } catch {
        return "";
      }
    },
  };
};
