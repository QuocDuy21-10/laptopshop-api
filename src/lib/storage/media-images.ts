import path from "path";
import { mkdir, unlink, writeFile } from "fs/promises";

import { logger } from "lib/logger";
import type { ObjectStorage } from "lib/storage/object-storage";

// bucket key prefixes and public/ subfolders; the mappers build the same /images/... URLs
export const MEDIA_DIRS = {
  product: "images/product",
  banner: "images/banner",
  avatar: "images",
} as const;
export type MediaDir = (typeof MEDIA_DIRS)[keyof typeof MEDIA_DIRS];

// only names the upload middleware generates; seed assets and legacy uploads never match
const UPLOADED_IMAGE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
export const isUploadedImageName = (name: string) => UPLOADED_IMAGE.test(name);

export const isMediaDir = (dir: unknown): dir is MediaDir =>
  typeof dir === "string" && Object.values<string>(MEDIA_DIRS).includes(dir);

let storage: ObjectStorage | null = null;

// createApp sets this once; null keeps writing under public/ (local dev, tests)
export const configureMediaStorage = (next: ObjectStorage | null) => {
  storage = next;
};

export const saveMediaImage = async (dir: MediaDir, filename: string, body: Buffer) => {
  if (storage) {
    await storage.putObject({
      key: `${dir}/${filename}`,
      body,
      contentLength: body.length,
      contentType: "image/webp",
    });
    return;
  }
  const destination = path.join("public", dir);
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, filename), body);
};

export const readMediaImage = async (dir: MediaDir, filename: string) =>
  storage ? storage.getObject(`${dir}/${filename}`) : null;

// best-effort: a leftover image must never fail a request whose database change already succeeded
export const removeMediaImage = async (dir: MediaDir, filename: string | null | undefined) => {
  if (!filename || !isUploadedImageName(filename)) return;
  try {
    if (storage) await storage.deleteObject(`${dir}/${filename}`);
    else await unlink(path.join("public", dir, filename));
  } catch (error) {
    logger.warn({ err: error, dir, filename }, "media image cleanup failed");
  }
};
