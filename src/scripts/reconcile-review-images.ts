import { prisma } from "config/client";
import { env } from "config/env";
import { logger } from "lib/logger";
import { createS3ObjectStorage } from "lib/storage/s3-object-storage";
import type { ObjectStorage } from "lib/storage/object-storage";
import { randomUUID } from "node:crypto";
import {
  finalizeReviewImageSync,
  type ReviewImageSyncDeps,
} from "modules/reviews/review-image-sync.service";
import { reviewImageSelect, type ReviewImageRow } from "modules/reviews/review-images.mapper";
import type { ReviewImageSyncManifest } from "modules/reviews/review-image-sync.types";

export type ReconcileResult = {
  pending: number;
  deleting: number;
  missingReady: number[];
  errors: number;
};

export type ReconcileDeps = { storage: ObjectStorage };

export type ReviewImageSyncReconcileResult = {
  finalized: number;
  skipped: number;
  expired: number;
  errors: number;
};

export const reconcileReviewImageSyncOperations = async (
  deps: ReconcileDeps,
  now = new Date(),
  batchSize = 100,
): Promise<ReviewImageSyncReconcileResult> => {
  const operations =
    (await prisma.reviewImageSyncOperation.findMany({
      where: { status: { in: ["PROCESSING", "WAITING_RETRY"] } },
      orderBy: { updatedAt: "asc" },
      take: batchSize,
    })) ?? [];
  let finalized = 0;
  let skipped = 0;
  let expired = 0;
  let errors = 0;
  for (const operation of operations) {
    if (
      operation.status === "PROCESSING" &&
      operation.leaseExpiresAt &&
      operation.leaseExpiresAt > now
    ) {
      skipped += 1;
      continue;
    }
    const rows = (await prisma.reviewImage.findMany({
      where: {
        syncOperationId: operation.id,
        status: { in: ["PENDING", "READY"] },
        deletedAt: null,
      },
      select: reviewImageSelect,
    })) as ReviewImageRow[];
    const objectsPresent = await Promise.all(
      rows.map((row) => deps.storage.objectExists(row.objectKey)),
    );
    const retryExpired =
      now.getTime() - operation.updatedAt.getTime() >= env.REVIEW_IMAGE_SYNC_RETRY_TTL_MS;
    if (objectsPresent.some((present) => !present)) {
      if (!retryExpired) {
        await prisma.reviewImageSyncOperation.update({
          where: { id: operation.id },
          data: { status: "WAITING_RETRY", leaseOwner: null, leaseExpiresAt: null },
        });
      } else {
        await prisma.reviewImageSyncOperation.update({
          where: { id: operation.id },
          data: {
            status: "FAILED",
            errorCode: "REVIEW_IMAGE_STORAGE_UNAVAILABLE",
            errorDetails: { status: 503, message: "Review image storage is unavailable" },
            leaseOwner: null,
            leaseExpiresAt: null,
            completedAt: now,
            expiresAt: new Date(now.getTime() + env.REVIEW_IMAGE_IDEMPOTENCY_RETENTION_MS),
          },
        });
        if (rows.length)
          await prisma.reviewImage.updateMany({
            where: { id: { in: rows.map((row) => row.id) }, status: "PENDING" },
            data: {
              status: "DELETING",
              deletedAt: now,
              purgeAfter: new Date(now.getTime() + env.REVIEW_IMAGE_IDEMPOTENCY_RETENTION_MS),
            },
          });
        expired += 1;
      }
      continue;
    }
    const leaseOwner = randomUUID();
    const claimed = await prisma.reviewImageSyncOperation.updateMany({
      where: {
        id: operation.id,
        status: { in: ["PROCESSING", "WAITING_RETRY"] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        status: "PROCESSING",
        leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + env.REVIEW_IMAGE_SYNC_LEASE_MS),
        attemptCount: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      skipped += 1;
      continue;
    }
    const claimedOperation = await prisma.reviewImageSyncOperation.findUnique({
      where: { id: operation.id },
    });
    if (!claimedOperation) {
      skipped += 1;
      continue;
    }
    try {
      await finalizeReviewImageSync(
        {
          storage: deps.storage,
          urlTtlSeconds: env.REVIEW_IMAGE_URL_TTL_SECONDS,
          now: () => now,
        } as ReviewImageSyncDeps,
        operation.userId,
        claimedOperation,
        rows as never,
        claimedOperation.manifest as unknown as ReviewImageSyncManifest,
        leaseOwner,
      );
      finalized += 1;
    } catch (error) {
      errors += 1;
      logger.error(
        { err: error, operationId: operation.id },
        "review image sync reconciliation failed",
      );
    }
  }
  return { finalized, skipped, expired, errors };
};

export const reconcileReviewImages = async (
  deps: ReconcileDeps,
  cutoff: Date,
): Promise<ReconcileResult> => {
  const [pending, deleting, ready] = await Promise.all([
    prisma.reviewImage.findMany({
      where: { status: "PENDING", updatedAt: { lt: cutoff }, syncOperationId: null },
      select: { id: true, objectKey: true, deletedAt: true, purgeAfter: true },
    }),
    prisma.reviewImage.findMany({
      where: { status: "DELETING", storageDeletedAt: null },
      select: { id: true, objectKey: true, deletedAt: true, purgeAfter: true },
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
    if (image.purgeAfter && image.purgeAfter > cutoff) continue;
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
  const storage = createS3ObjectStorage({
    enabled: env.REVIEW_IMAGES_ENABLED,
    endpoint: env.REVIEW_IMAGE_S3_ENDPOINT,
    region: env.REVIEW_IMAGE_S3_REGION,
    bucket: env.REVIEW_IMAGE_S3_BUCKET,
    accessKeyId: env.REVIEW_IMAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.REVIEW_IMAGE_S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.REVIEW_IMAGE_S3_FORCE_PATH_STYLE,
  });
  if (!storage) {
    logger.info("Review image storage is disabled; nothing to reconcile");
    return;
  }
  const result = await reconcileReviewImages({ storage }, new Date(Date.now() - 15 * 60 * 1000));
  const syncResult = await reconcileReviewImageSyncOperations({ storage });
  logger.info({ ...result, sync: syncResult }, "review image reconciliation complete");
  if (result.errors > 0 || syncResult.errors > 0) process.exitCode = 1;
};

if (require.main === module)
  void main().catch((error) => {
    logger.error({ err: error }, "review image reconciliation failed");
    process.exitCode = 1;
  });
