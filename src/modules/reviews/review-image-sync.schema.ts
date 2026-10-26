import { z } from "zod";
import { AppError } from "lib/errors";
import type { ReviewImageSyncManifest } from "modules/reviews/review-image-sync.types";

const clientId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const manifestSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    items: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("existing"), clientId, imageId: z.number().int().positive() }),
          z.object({ kind: z.literal("new"), clientId, fileIndex: z.number().int().nonnegative() }),
        ]),
      )
      .max(3),
  })
  .strict();

const invalidManifest = (details?: unknown) =>
  new AppError(
    "Review image sync manifest is invalid",
    400,
    "REVIEW_IMAGE_SYNC_MANIFEST_INVALID",
    details,
  );

export const parseReviewImageSyncManifest = (
  value: unknown,
  fileCount: number,
): ReviewImageSyncManifest => {
  if (!Number.isInteger(fileCount) || fileCount < 0 || fileCount > 3) throw invalidManifest();

  let parsedValue = value;
  if (typeof value === "string") {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      throw invalidManifest({ path: ["manifest"], message: "manifest must be valid JSON" });
    }
  }

  const parsed = manifestSchema.safeParse(parsedValue);
  if (!parsed.success) throw invalidManifest(parsed.error.issues);

  const items = parsed.data.items;
  const clientIds = items.map((item) => item.clientId);
  if (new Set(clientIds).size !== clientIds.length) throw invalidManifest({ field: "clientId" });

  const existingIds = items.flatMap((item) => (item.kind === "existing" ? [item.imageId] : []));
  if (new Set(existingIds).size !== existingIds.length) throw invalidManifest({ field: "imageId" });

  const fileIndexes = items
    .flatMap((item) => (item.kind === "new" ? [item.fileIndex] : []))
    .sort((a, b) => a - b);
  if (
    fileIndexes.length !== fileCount ||
    fileIndexes.some((fileIndex, index) => fileIndex !== index)
  )
    throw invalidManifest({ field: "fileIndex" });

  return {
    expectedVersion: parsed.data.expectedVersion,
    items: parsed.data.items as ReviewImageSyncManifest["items"],
  };
};
