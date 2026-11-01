import path from "path";
import { unlink } from "fs/promises";

import { logger } from "lib/logger";

export const BANNER_IMAGE_DIR = "images/banner";

// cleanup is best-effort: a leftover file must never fail the request that already succeeded
export const removeBannerImageFile = async (filename: string | null) => {
  if (!filename) return;
  try {
    await unlink(path.join("public", BANNER_IMAGE_DIR, path.basename(filename)));
  } catch (error) {
    logger.warn({ err: error, filename }, "home banner image cleanup failed");
  }
};
