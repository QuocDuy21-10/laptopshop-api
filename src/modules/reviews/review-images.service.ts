import { Prisma } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { logger } from "lib/logger";
import type { ReviewImageStorage } from "lib/storage/review-image-storage";
import {
  processReviewImage,
  type ProcessedReviewImage,
} from "modules/reviews/review-images.processor";
import {
  reviewImageSelect,
  toOwnerReviewImageDto,
  type OwnerReviewImageDto,
  type ReviewImageRow,
} from "modules/reviews/review-images.mapper";

const MAX_REVIEW_IMAGES = 3;

export type ReviewImageDeps = { storage: ReviewImageStorage; now?: () => Date };

const nowOf = (deps: ReviewImageDeps) => deps.now?.() ?? new Date();
const reviewNotFound = () => new AppError("Review not found", 404, "REVIEW_NOT_FOUND");

const lockOwnedReview = async (tx: Prisma.TransactionClient, userId: number, reviewId: number) => {
  const locked = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM reviews
    WHERE id = ${reviewId} AND userId = ${userId} AND deletedAt IS NULL
    FOR UPDATE
  `;
  if (!locked.length) throw reviewNotFound();
  const review = await tx.review.findFirst({
    where: { id: reviewId, userId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!review) throw reviewNotFound();
  return review;
};

const activeImages = (tx: Prisma.TransactionClient, reviewId: number) =>
  tx.reviewImage.findMany({
    where: { reviewId, status: { in: ["PENDING", "READY"] }, deletedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: reviewImageSelect,
  });

const reserveImages = async (
  userId: number,
  reviewId: number,
  processed: ProcessedReviewImage[],
  now: Date,
) =>
  prisma.$transaction(async (tx) => {
    await lockOwnedReview(tx, userId, reviewId);
    const existing = await activeImages(tx, reviewId);
    if (existing.length + processed.length > MAX_REVIEW_IMAGES)
      throw new AppError(
        "A review can contain at most three images",
        409,
        "REVIEW_IMAGE_LIMIT_REACHED",
      );

    return Promise.all(
      processed.map((item, index) =>
        tx.reviewImage.create({
          data: {
            reviewId,
            objectKey: `reviews/${reviewId}/${uuid()}.webp`,
            mimeType: item.mimeType,
            byteSize: item.byteSize,
            width: item.width,
            height: item.height,
            position: existing.length + index,
            status: "PENDING",
            createdAt: now,
            updatedAt: now,
          },
          select: reviewImageSelect,
        }),
      ),
    );
  });

const markFailedReservations = async (ids: number[], now: Date) => {
  await prisma.reviewImage.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "DELETING", deletedAt: now },
  });
};

export const addReviewImages = async (
  deps: ReviewImageDeps,
  userId: number,
  reviewId: number,
  files: Express.Multer.File[],
): Promise<OwnerReviewImageDto[]> => {
  if (files.length === 0 || files.length > MAX_REVIEW_IMAGES)
    throw new AppError(
      "A review can contain at most three images",
      409,
      "REVIEW_IMAGE_LIMIT_REACHED",
    );

  const processed = await Promise.all(files.map(processReviewImage));
  const now = nowOf(deps);
  const reservations = (await reserveImages(userId, reviewId, processed, now)) as ReviewImageRow[];
  const uploaded = reservations.filter(Boolean);

  try {
    await Promise.all(
      reservations.map((row, index) =>
        deps.storage.putObject({
          key: row.objectKey,
          body: processed[index].buffer,
          contentLength: processed[index].byteSize,
        }),
      ),
    );
  } catch (error) {
    await markFailedReservations(
      reservations.map((row) => row.id),
      now,
    );
    await Promise.allSettled(uploaded.map((row) => deps.storage.deleteObject(row.objectKey)));
    throw new AppError(
      "Review image storage is unavailable",
      503,
      "REVIEW_IMAGE_STORAGE_UNAVAILABLE",
      {
        cause: error instanceof Error ? error.message : "unknown",
      },
    );
  }

  await prisma.reviewImage.updateMany({
    where: { id: { in: reservations.map((row) => row.id) }, status: "PENDING" },
    data: { status: "READY" },
  });
  const ready = await prisma.reviewImage.findMany({
    where: { id: { in: reservations.map((row) => row.id) } },
    orderBy: { position: "asc" },
    select: reviewImageSelect,
  });
  return (ready as ReviewImageRow[]).map(toOwnerReviewImageDto);
};

export const reorderReviewImages = async (
  userId: number,
  reviewId: number,
  imageIds: number[],
): Promise<OwnerReviewImageDto[]> => {
  return prisma.$transaction(async (tx) => {
    await lockOwnedReview(tx, userId, reviewId);
    const existing = (await tx.reviewImage.findMany({
      where: { reviewId, status: "READY", deletedAt: null },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: reviewImageSelect,
    })) as ReviewImageRow[];
    const expected = new Set(existing.map((row) => row.id));
    const actual = new Set(imageIds);
    if (
      actual.size !== imageIds.length ||
      actual.size !== expected.size ||
      imageIds.some((id) => !expected.has(id))
    )
      throw new AppError(
        "Image order does not match this review",
        400,
        "REVIEW_IMAGE_ORDER_INVALID",
      );

    await Promise.all(
      imageIds.map((id, position) =>
        tx.reviewImage.update({ where: { id }, data: { position }, select: reviewImageSelect }),
      ),
    );
    const reordered = await tx.reviewImage.findMany({
      where: { reviewId, status: "READY", deletedAt: null },
      orderBy: { position: "asc" },
      select: reviewImageSelect,
    });
    return (reordered as ReviewImageRow[]).map(toOwnerReviewImageDto);
  });
};

export const deleteReviewImage = async (
  deps: ReviewImageDeps,
  userId: number,
  reviewId: number,
  imageId: number,
): Promise<void> => {
  const reservation = await prisma.$transaction(async (tx) => {
    await lockOwnedReview(tx, userId, reviewId);
    const image = (await tx.reviewImage.findFirst({
      where: { id: imageId, reviewId },
      select: reviewImageSelect,
    })) as ReviewImageRow | null;
    if (!image) throw new AppError("Review image not found", 404, "REVIEW_IMAGE_NOT_FOUND");
    if (image.deletedAt) return null;
    await tx.reviewImage.update({
      where: { id: imageId },
      data: { status: "DELETING", deletedAt: nowOf(deps) },
      select: reviewImageSelect,
    });
    return image;
  });
  if (!reservation) return;

  try {
    await deps.storage.deleteObject(reservation.objectKey);
    await prisma.reviewImage.update({
      where: { id: imageId },
      data: { storageDeletedAt: nowOf(deps) },
      select: reviewImageSelect,
    });
  } catch (error) {
    logger.error({ err: error, reviewImageId: imageId }, "review image cleanup failed");
  }
};
