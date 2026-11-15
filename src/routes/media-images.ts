import type { Express } from "express";
import { pipeline } from "stream/promises";

import { notFound } from "lib/errors";
import { MEDIA_DIRS, isUploadedImageName, readMediaImage } from "lib/storage/media-images";

// uuid names never change content, so browsers may keep them for a year without revalidating
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const IMAGE_PATH = /^\/images\/(?:(product|banner)\/)?([^/]+)$/;

// uploaded images live in a private bucket; bundled seed images are already served by express.static
export const registerMediaRoutes = (app: Express) => {
  app.get("/images/*path", async (req, res) => {
    const match = IMAGE_PATH.exec(req.path);
    // the whitelist keeps any other key in the bucket unreachable
    if (!match || !isUploadedImageName(match[2])) throw notFound("Image");
    const segment = match[1];
    const dir =
      segment === "product" || segment === "banner" ? MEDIA_DIRS[segment] : MEDIA_DIRS.avatar;
    const image = await readMediaImage(dir, match[2]);
    if (!image) throw notFound("Image");
    res.set({ "Content-Type": image.contentType ?? "image/webp", "Cache-Control": CACHE_CONTROL });
    if (image.etag) res.set("ETag", image.etag);
    if (req.fresh) {
      image.body.destroy();
      res.status(304).end();
      return;
    }
    if (image.contentLength !== undefined) res.set("Content-Length", String(image.contentLength));
    await pipeline(image.body, res);
  });
};
