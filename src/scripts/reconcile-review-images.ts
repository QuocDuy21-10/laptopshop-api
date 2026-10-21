import { prisma } from "config/client";
import { env } from "config/env";
import { logger } from "lib/logger";
import { createReviewImageStorage } from "lib/storage/s3-review-image-storage";
import type { ReviewImageStorage } from "lib/storage/review-image-storage";

export type ReconcileResult = {
  pending: number;
  deleting: number;
  missingReady: number[];
  errors: number;
};

export type ReconcileDeps = { storage: ReviewImageStorage };

export const reconcileReviewImages = async (
  deps: ReconcileDeps,
  cutoff: Date,
): Promise<ReconcileResult> => {
  const [pending, deleting, ready] = await Promise.all([
    prisma.reviewImage.findMany({
      where: { status: "PENDING", updatedAt: { lt: cutoff } },
      select: { id: true, objectKey: true, deletedAt: true },
    }),
    prisma.reviewImage.findMany({
      where: { status: "DELETING", storageDeletedAt: null },
      select: { id: true, objectKey: true, deletedAt: true },
    }),
    prisma.reviewImage.findMany({
      where: { status: "READY", deletedAt: null },
      select: { id: true, objectKey: true },
    }),
  ]);
  let errors = 0;
  let pendingCount = 0;
  let deletingCount = 0;

  for (const image of pending) {
    try {
      await deps.storage.deleteObject(image.objectKey);
      await prisma.reviewImage.update({
        where: { id: image.id },
        data: {
          status: "DELETING",
          deletedAt: image.deletedAt ?? new Date(),
          storageDeletedAt: new Date(),
        },
        select: { id: true },
      });
      pendingCount += 1;
    } catch (error) {
      errors += 1;
      logger.error(
        { err: error, reviewImageId: image.id },
        "stale pending review image cleanup failed",
      );
    }
  }

  for (const image of deleting) {
    try {
      await deps.storage.deleteObject(image.objectKey);
      await prisma.reviewImage.update({
        where: { id: image.id },
        data: { storageDeletedAt: new Date() },
        select: { id: true },
      });
      deletingCount += 1;
    } catch (error) {
      errors += 1;
      logger.error({ err: error, reviewImageId: image.id }, "review image deletion retry failed");
    }
  }

  const missingReady: number[] = [];
  for (const image of ready) {
    try {
      if (!(await deps.storage.objectExists(image.objectKey))) missingReady.push(image.id);
    } catch (error) {
      errors += 1;
      logger.error({ err: error, reviewImageId: image.id }, "review image existence check failed");
    }
  }

  return { pending: pendingCount, deleting: deletingCount, missingReady, errors };
};

const main = async () => {
  const storage = createReviewImageStorage(env);
  if (!storage) {
    logger.info("Review image storage is disabled; nothing to reconcile");
    return;
  }
  const result = await reconcileReviewImages({ storage }, new Date(Date.now() - 15 * 60 * 1000));
  logger.info(result, "review image reconciliation complete");
  if (result.errors > 0) process.exitCode = 1;
};

if (require.main === module)
  void main().catch((error) => {
    logger.error({ err: error }, "review image reconciliation failed");
    process.exitCode = 1;
  });
