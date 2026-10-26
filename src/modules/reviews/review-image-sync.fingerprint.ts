import crypto from "node:crypto";
import { sha256Canonical } from "lib/idempotency";
import type { ReviewImageSyncManifest } from "modules/reviews/review-image-sync.types";

const fileFingerprint = (file: Express.Multer.File) =>
  [
    file.mimetype,
    file.size ?? file.buffer.length,
    crypto.createHash("sha256").update(file.buffer).digest("hex"),
  ] as const;

export const createReviewImageSyncFingerprint = (
  reviewId: number,
  manifest: ReviewImageSyncManifest,
  files: readonly Express.Multer.File[],
) =>
  sha256Canonical([
    reviewId,
    manifest.expectedVersion,
    manifest.items.map((item) =>
      item.kind === "existing"
        ? [item.kind, item.clientId, item.imageId]
        : [item.kind, item.clientId, item.fileIndex],
    ),
    files.map(fileFingerprint),
  ]);
