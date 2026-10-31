import type { Prisma } from "@prisma/client";

import { prisma } from "config/client";
import { reviewImageSelect, type ReviewImageRow } from "modules/reviews/review-images.mapper";

export type ReviewImageSyncClient = Prisma.TransactionClient;

export const lockOwnedReviewStateForSync = async (
  tx: ReviewImageSyncClient,
  userId: number,
  reviewId: number,
) => {
  const locked = await tx.$queryRaw<
    Array<{ id: number; imageVersion: number; deletedAt: Date | null }>
  >`
    SELECT id, imageVersion, deletedAt FROM reviews
    WHERE id = ${reviewId} AND userId = ${userId}
    FOR UPDATE
  `;
  return locked[0] ?? null;
};

export const lockOwnedSyncOperation = async (
  tx: ReviewImageSyncClient,
  userId: number,
  reviewId: number,
  operationId: number,
) => {
  await tx.$queryRaw`
    SELECT id FROM review_image_sync_operations
    WHERE id = ${operationId} AND userId = ${userId} AND reviewId = ${reviewId}
    FOR UPDATE
  `;
  const operation = await tx.reviewImageSyncOperation.findUnique({ where: { id: operationId } });
  return operation?.userId === userId && operation.reviewId === reviewId ? operation : null;
};

export const activeReviewImages = async (
  tx: ReviewImageSyncClient,
  reviewId: number,
): Promise<ReviewImageRow[]> =>
  (await tx.reviewImage.findMany({
    where: { reviewId, status: "READY", deletedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: reviewImageSelect,
  })) as ReviewImageRow[];

export const findSyncOperation = (userId: number, reviewId: number, idempotencyKey: string) =>
  prisma.reviewImageSyncOperation.findUnique({
    where: { userId_reviewId_idempotencyKey: { userId, reviewId, idempotencyKey } },
  });
