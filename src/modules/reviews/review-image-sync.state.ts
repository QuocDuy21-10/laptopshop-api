import type { ReviewImageSyncOperation } from "@prisma/client";

import { env } from "config/env";
import type { AppError } from "lib/errors";
import type { ReviewImageSyncClaim } from "modules/reviews/review-image-sync.types";
import type { ReviewImageSyncClient } from "modules/reviews/review-image-sync.repository";

const claimWhere = (claim: ReviewImageSyncClaim) => ({
  id: claim.operationId,
  userId: claim.userId,
  reviewId: claim.reviewId,
  status: "PROCESSING" as const,
  leaseOwner: claim.leaseOwner,
});

export const isReviewImageSyncRetryExpired = (
  operation: Pick<ReviewImageSyncOperation, "createdAt">,
  now: Date,
) => now.getTime() >= operation.createdAt.getTime() + env.REVIEW_IMAGE_SYNC_RETRY_TTL_MS;

export const failClaimedReviewImageSync = async (
  tx: ReviewImageSyncClient,
  claim: ReviewImageSyncClaim,
  error: AppError,
  now: Date,
): Promise<boolean> => {
  const expiresAt = new Date(now.getTime() + env.REVIEW_IMAGE_IDEMPOTENCY_RETENTION_MS);
  const changed = await tx.reviewImageSyncOperation.updateMany({
    where: claimWhere(claim),
    data: {
      status: "FAILED",
      errorCode: error.code,
      errorDetails: JSON.parse(
        JSON.stringify({
          status: error.status,
          message: error.message,
          details: error.details ?? null,
        }),
      ),
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: now,
      expiresAt,
    },
  });
  if (changed.count !== 1) return false;
  await tx.reviewImage.updateMany({
    where: { syncOperationId: claim.operationId, status: "PENDING" },
    // A review deletion may have attempted storage deletion before the PUT finished.
    data: { status: "DELETING", deletedAt: now, storageDeletedAt: null, purgeAfter: expiresAt },
  });
  return true;
};

export const waitForClaimedReviewImageSyncRetry = async (
  tx: ReviewImageSyncClient,
  claim: ReviewImageSyncClaim,
  _now: Date,
): Promise<boolean> => {
  const changed = await tx.reviewImageSyncOperation.updateMany({
    where: claimWhere(claim),
    data: { status: "WAITING_RETRY", leaseOwner: null, leaseExpiresAt: null },
  });
  return changed.count === 1;
};
