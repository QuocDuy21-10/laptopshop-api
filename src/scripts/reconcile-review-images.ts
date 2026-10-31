import { randomUUID } from "node:crypto";
import type { ReviewImageSyncOperation } from "@prisma/client";

import { env } from "config/env";
import { AppError } from "lib/errors";
import { logger } from "lib/logger";
import { prisma } from "config/client";
import type { ObjectStorage } from "lib/storage/object-storage";
import { createS3ObjectStorage } from "lib/storage/s3-object-storage";
import { reviewImageSelect } from "modules/reviews/review-images.mapper";
import {
  failClaimedReviewImageSync,
  waitForClaimedReviewImageSyncRetry,
  isReviewImageSyncRetryExpired,
} from "modules/reviews/review-image-sync.state";
import { parseReviewImageSyncManifest } from "modules/reviews/review-image-sync.schema";
import { finalizeReviewImageSync } from "modules/reviews/review-image-sync.service";
import {
  lockOwnedReviewStateForSync,
  lockOwnedSyncOperation,
} from "modules/reviews/review-image-sync.repository";

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

const reconcileReviewImageSyncOperation = async (
  deps: ReconcileDeps,
  operation: ReviewImageSyncOperation,
  now: Date,
): Promise<"finalized" | "failed" | "expired" | "waiting" | "skipped"> => {
  if (
    operation.status === "PROCESSING" &&
    operation.leaseExpiresAt &&
    operation.leaseExpiresAt > now
  )
    return "skipped";
  const leaseOwner = randomUUID();
  const claimed = await prisma.$transaction(async (tx) => {
    const review = await lockOwnedReviewStateForSync(tx, operation.userId, operation.reviewId);
    const current = await lockOwnedSyncOperation(
      tx,
      operation.userId,
      operation.reviewId,
      operation.id,
    );
    if (
      !current ||
      !["PROCESSING", "WAITING_RETRY"].includes(current.status) ||
      (current.leaseExpiresAt && current.leaseExpiresAt > now)
    )
      return null;
    const leaseExpiresAt = new Date(now.getTime() + env.REVIEW_IMAGE_SYNC_LEASE_MS);
    const result = await tx.reviewImageSyncOperation.updateMany({
      where: {
        id: current.id,
        userId: current.userId,
        reviewId: current.reviewId,
        status: current.status,
        leaseOwner: current.leaseOwner,
      },
      data: { status: "PROCESSING", leaseOwner, leaseExpiresAt, attemptCount: { increment: 1 } },
    });
    if (result.count !== 1) return null;
    const rows = await tx.reviewImage.findMany({
      where: { syncOperationId: current.id, status: { in: ["PENDING", "READY"] }, deletedAt: null },
      select: reviewImageSelect,
    });
    return {
      review,
      operation: { ...current, status: "PROCESSING" as const, leaseOwner, leaseExpiresAt },
      rows,
    };
  });
  if (!claimed) return "skipped";
  const claim = {
    operationId: operation.id,
    userId: operation.userId,
    reviewId: operation.reviewId,
    leaseOwner,
  };
  const transition = async (error?: AppError) =>
    prisma.$transaction(async (tx) => {
      await lockOwnedReviewStateForSync(tx, operation.userId, operation.reviewId);
      await lockOwnedSyncOperation(tx, operation.userId, operation.reviewId, operation.id);
      return error
        ? failClaimedReviewImageSync(tx, claim, error, now)
        : waitForClaimedReviewImageSyncRetry(tx, claim, now);
    });
  if (!claimed.review || claimed.review.deletedAt) {
    return (await transition(new AppError("Review not found", 404, "REVIEW_NOT_FOUND")))
      ? "failed"
      : "skipped";
  }
  if (isReviewImageSyncRetryExpired(claimed.operation, now)) {
    return (await transition(
      new AppError("Image retry deadline has expired", 503, "REVIEW_IMAGE_STORAGE_UNAVAILABLE"),
    ))
      ? "expired"
      : "skipped";
  }
  let manifest;
  try {
    manifest = parseReviewImageSyncManifest(claimed.operation.manifest, claimed.rows.length);
    const items = manifest.items.filter((item) => item.kind === "new");
    if (
      items.some(
        (item) =>
          !claimed.rows.some(
            (row) => row.syncClientId === item.clientId && row.status === "PENDING",
          ),
      )
    )
      throw new Error("Missing reservation");
  } catch {
    return (await transition(
      new AppError("Image reservations are incomplete", 409, "REVIEW_IMAGE_SYNC_FAILED"),
    ))
      ? "failed"
      : "skipped";
  }
  const objectsPresent = await Promise.all(
    claimed.rows.map((row) => deps.storage.objectExists(row.objectKey)),
  );
  if (objectsPresent.some((present) => !present))
    return (await transition()) ? "waiting" : "skipped";
  try {
    await finalizeReviewImageSync(
      { storage: deps.storage, now: () => now },
      operation.userId,
      claimed.operation,
      claimed.rows,
      manifest,
      leaseOwner,
    );
    return "finalized";
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === "REVIEW_IMAGE_SYNC_LEASE_LOST") return "skipped";
      if (
        [
          "REVIEW_IMAGE_VERSION_CONFLICT",
          "REVIEW_IMAGE_SET_CHANGED",
          "REVIEW_NOT_FOUND",
          "REVIEW_IMAGE_SYNC_FAILED",
        ].includes(error.code)
      )
        return "failed";
    }
    throw error;
  }
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
  const result = { finalized: 0, skipped: 0, expired: 0, errors: 0, failed: 0, waiting: 0 };
  for (const operation of operations) {
    try {
      result[await reconcileReviewImageSyncOperation(deps, operation, now)] += 1;
    } catch (error) {
      result.errors += 1;
      logger.error(
        { err: error, operationId: operation.id },
        "review image sync reconciliation failed",
      );
    }
  }
  return result;
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
