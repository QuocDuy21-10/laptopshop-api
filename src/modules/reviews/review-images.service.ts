import { Prisma } from "@prisma/client";
import { v4 as uuid } from "uuid";
import { env } from "config/env";
import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { logger } from "lib/logger";
import type { ObjectStorage } from "lib/storage/object-storage";
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
import {
  reviewImageNow,
  reviewImageTtl,
  type ReviewImageRuntime,
} from "modules/reviews/review-image-runtime";

const MAX_REVIEW_IMAGES = 3;

export type ReviewImageDeps = ReviewImageRuntime & { storage: ObjectStorage };

const nowOf = (deps: ReviewImageDeps) => reviewImageNow(deps);
const ttlOf = (deps: ReviewImageDeps) => reviewImageTtl(deps, env.REVIEW_IMAGE_URL_TTL_SECONDS);
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

const toSignedOwnerImage = async (
  deps: ReviewImageDeps,
  row: ReviewImageRow,
  now = nowOf(deps),
) => {
  const ttl = ttlOf(deps);
  return toOwnerReviewImageDto(
    row,
    await deps.storage.getSignedReadUrl(row.objectKey, ttl),
    new Date(now.getTime() + ttl * 1000).toISOString(),
  );
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
  const uploads = await Promise.allSettled(
    reservations.map((row, index) =>
      deps.storage.putObject({
        key: row.objectKey,
        body: processed[index].buffer,
        contentLength: processed[index].byteSize,
        contentType: processed[index].mimeType,
      }),
    ),
  );
  const uploaded = reservations.filter((_, index) => uploads[index].status === "fulfilled");
  let finalized = 0;
  if (uploads.every((result) => result.status === "fulfilled")) {
    const result = await prisma.$transaction(async (tx) => {
      const reviewRows = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM reviews WHERE id = ${reviewId} AND deletedAt IS NULL FOR UPDATE
      `;
      if (!reviewRows.length) return { count: 0 };
      const result = await tx.reviewImage.updateMany({
        where: {
          id: { in: reservations.map((row) => row.id) },
          status: "PENDING",
          deletedAt: null,
        },
        data: { status: "READY" },
      });
      if (result.count === reservations.length)
        await tx.review.update({
          where: { id: reviewId },
          data: { imageVersion: { increment: 1 } },
        });
      return result;
    });
    finalized = result.count;
  }
  if (uploads.some((result) => result.status === "rejected") || finalized !== reservations.length) {
    await markFailedReservations(
      reservations.map((row) => row.id),
      now,
    );
    await Promise.allSettled(uploaded.map((row) => deps.storage.deleteObject(row.objectKey)));
    throw new AppError(
      "Review image storage is unavailable",
      503,
      "REVIEW_IMAGE_STORAGE_UNAVAILABLE",
    );
  }

  const ready = await prisma.reviewImage.findMany({
    where: { id: { in: reservations.map((row) => row.id) }, status: "READY", deletedAt: null },
    orderBy: { position: "asc" },
    select: reviewImageSelect,
  });
  return Promise.all((ready as ReviewImageRow[]).map((row) => toSignedOwnerImage(deps, row)));
};

export const reorderReviewImages = async (
  deps: ReviewImageDeps,
  userId: number,
  reviewId: number,
  imageIds: number[],
): Promise<OwnerReviewImageDto[]> => {
  const reordered = await prisma.$transaction(async (tx) => {
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

    const changed = existing.some((row, position) => row.id !== imageIds[position]);

    await Promise.all(
      imageIds.map((id, position) =>
        tx.reviewImage.update({ where: { id }, data: { position }, select: reviewImageSelect }),
      ),
    );
    if (changed)
      await tx.review.update({ where: { id: reviewId }, data: { imageVersion: { increment: 1 } } });
    const reordered = await tx.reviewImage.findMany({
      where: { reviewId, status: "READY", deletedAt: null },
      orderBy: { position: "asc" },
      select: reviewImageSelect,
    });
    return reordered as ReviewImageRow[];
  });
  return Promise.all((reordered as ReviewImageRow[]).map((row) => toSignedOwnerImage(deps, row)));
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
    const remaining = (await tx.reviewImage.findMany({
      where: { reviewId, status: "READY", deletedAt: null, id: { not: imageId } },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    })) as Array<{ id: number }>;
    await Promise.all(
      remaining.map((item, position) =>
        tx.reviewImage.update({ where: { id: item.id }, data: { position }, select: { id: true } }),
      ),
    );
    await tx.review.update({ where: { id: reviewId }, data: { imageVersion: { increment: 1 } } });
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
