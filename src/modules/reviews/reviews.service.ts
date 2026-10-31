import { type Prisma } from "@prisma/client";

import { pageArgs, pageMeta } from "lib/http";
import { env } from "config/env";
import { AppError, isUniqueViolation, notFound } from "lib/errors";
import { prisma } from "config/client";
import { assertDayRange, createdAtRange } from "lib/shop-time";
import {
  publicReviewSelect,
  ownerReviewSelect,
  adminReviewSelect,
  toAdminReviewDto,
  toOwnerReviewDto,
  toPublicReviewDto,
  type OwnerReviewDto,
  type OwnerReviewRow,
  type AdminReviewDetailDto,
  type AdminReviewListItemDto,
  type AdminReviewRow,
  type AdminReviewSummaryDto,
  type ReviewEligibilityDto,
  type ReviewEligibilityReason,
  type PublicReviewDto,
  type PublicReviewRow,
  type ReviewSummaryDto,
  type ReviewImageDto,
} from "modules/reviews/reviews.mapper";
import type { ListProductReviewsQuery } from "modules/reviews/reviews.schema";
import type {
  AdminListReviewsQuery,
  CreateReviewBody,
  ModerateReviewBody,
  UpdateReviewBody,
} from "modules/reviews/reviews.schema";
import {
  reviewImageNow,
  reviewImageTtl,
  type ReviewImageRuntime,
} from "modules/reviews/review-image-runtime";
import type { ReviewImageRow } from "modules/reviews/review-images.mapper";

const defaultReviewImageRuntime: ReviewImageRuntime = {
  storage: null,
  urlTtlSeconds: env.REVIEW_IMAGE_URL_TTL_SECONDS,
};

const signReviewImages = async (
  images: ReviewImageRow[] | undefined,
  runtime: ReviewImageRuntime,
): Promise<ReviewImageDto[]> => {
  if (!runtime.storage || !images?.length) return [];
  const now = reviewImageNow(runtime);
  const ttl = reviewImageTtl(runtime, env.REVIEW_IMAGE_URL_TTL_SECONDS);
  return Promise.all(
    images.map(async (image) => ({
      id: image.id,
      url: await runtime.storage!.getSignedReadUrl(image.objectKey, ttl),
      urlExpiresAt: new Date(now.getTime() + ttl * 1000).toISOString(),
      mimeType: image.mimeType as "image/webp",
      width: image.width,
      height: image.height,
      position: image.position,
    })),
  );
};

const toPublicReviewWithImages = async (row: PublicReviewRow, runtime: ReviewImageRuntime) =>
  toPublicReviewDto(row, await signReviewImages(row.images, runtime));
const toOwnerReviewWithImages = async (row: OwnerReviewRow, runtime: ReviewImageRuntime) =>
  toOwnerReviewDto(row, await signReviewImages(row.images, runtime));
const toAdminReviewWithImages = async (row: AdminReviewRow, runtime: ReviewImageRuntime) =>
  toAdminReviewDto(row, await signReviewImages(row.images, runtime));

const publicReviewWhere = (productId: number, rating?: number): Prisma.ReviewWhereInput => ({
  productId,
  status: "PUBLISHED",
  deletedAt: null,
  ...(rating ? { rating } : {}),
});

const ensurePublicProduct = async (productId: number) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true },
  });
  if (!product?.isActive) throw notFound("Product");
};

const ensureProduct = async (productId: number) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) throw notFound("Product");
};

const reviewNotEligible = (reason: Exclude<ReviewEligibilityReason, "ALREADY_REVIEWED">) =>
  new AppError("You are not eligible to review this product", 403, "REVIEW_NOT_ELIGIBLE", {
    reason,
  });

const getExistingReview = async (userId: number, productId: number) =>
  (await prisma.review.findUnique({
    where: { userId_productId: { userId, productId } },
    select: ownerReviewSelect,
  })) as OwnerReviewRow | null;

const requirePublicName = async (userId: number, isAnonymous: boolean) => {
  if (isAnonymous) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  if (!user?.fullName?.trim())
    throw new AppError(
      "A full name is required for a public review",
      409,
      "REVIEW_FULL_NAME_REQUIRED",
    );
};

type ReviewEligibilityState =
  | { purchase: { id: number }; reason: null }
  | {
      purchase: null;
      reason: Exclude<ReviewEligibilityReason, "ALREADY_REVIEWED">;
    };

const resolveReviewEligibility = async (
  userId: number,
  productId: number,
): Promise<ReviewEligibilityState> => {
  const eligiblePurchase = await prisma.orderDetail.findFirst({
    where: {
      productId,
      order: { userId, status: "COMPLETED", paymentStatus: "PAYMENT_SUCCESS" },
    },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  if (eligiblePurchase) return { purchase: eligiblePurchase, reason: null };

  const completedPurchase = await prisma.orderDetail.findFirst({
    where: { productId, order: { userId, status: "COMPLETED" } },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  if (completedPurchase) return { purchase: null, reason: "PAYMENT_NOT_CONFIRMED" };

  const anyPurchase = await prisma.orderDetail.findFirst({
    where: { productId, order: { userId } },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  return {
    purchase: null,
    reason: anyPurchase ? "ORDER_NOT_COMPLETED" : "NOT_PURCHASED",
  };
};

const reviewOrderBy = (
  sort: ListProductReviewsQuery["sort"],
): Prisma.ReviewOrderByWithRelationInput[] => {
  if (sort === "highest") return [{ rating: "desc" }, { createdAt: "desc" }, { id: "desc" }];
  if (sort === "lowest") return [{ rating: "asc" }, { createdAt: "desc" }, { id: "desc" }];
  return [{ createdAt: "desc" }, { id: "desc" }];
};

const adminReviewWhere = (query: AdminListReviewsQuery): Prisma.ReviewWhereInput => {
  assertDayRange(query.from, query.to);
  return {
    ...(query.productId === undefined ? {} : { productId: query.productId }),
    ...(query.rating === undefined ? {} : { rating: query.rating }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.deleted === undefined ? {} : { deletedAt: query.deleted ? { not: null } : null }),
    ...(query.q
      ? {
          OR: [
            { product: { name: { contains: query.q } } },
            { user: { fullName: { contains: query.q } } },
            { user: { username: { contains: query.q } } },
          ],
        }
      : {}),
    ...createdAtRange(query.from, query.to),
  };
};

export const listPublishedReviews = async (
  productId: number,
  query: ListProductReviewsQuery,
  runtime: ReviewImageRuntime = defaultReviewImageRuntime,
): Promise<{ items: PublicReviewDto[]; meta: ReturnType<typeof pageMeta> }> => {
  await ensurePublicProduct(productId);
  const where = publicReviewWhere(productId, query.rating);
  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      select: publicReviewSelect,
      orderBy: reviewOrderBy(query.sort),
      ...pageArgs(query),
    }),
  ]);
  return {
    items: await Promise.all(
      (rows as PublicReviewRow[]).map((row) => toPublicReviewWithImages(row, runtime)),
    ),
    meta: pageMeta(query, total),
  };
};

export const getPublishedReviewSummary = async (productId: number): Promise<ReviewSummaryDto> => {
  await ensurePublicProduct(productId);
  const groups = await prisma.review.groupBy({
    by: ["rating"],
    where: publicReviewWhere(productId),
    _count: { _all: true },
  });
  const distribution: ReviewSummaryDto["distribution"] = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const group of groups)
    distribution[String(group.rating) as keyof typeof distribution] = group._count._all;
  const totalReviews = Object.values(distribution).reduce((sum, count) => sum + count, 0);
  const weightedSum = Object.entries(distribution).reduce(
    (sum, [rating, count]) => sum + Number(rating) * count,
    0,
  );
  return {
    productId,
    averageRating: totalReviews ? Math.round((weightedSum / totalReviews) * 10) / 10 : null,
    totalReviews,
    distribution,
  };
};

export const getReviewEligibility = async (
  userId: number,
  productId: number,
  runtime: ReviewImageRuntime = defaultReviewImageRuntime,
): Promise<ReviewEligibilityDto> => {
  await ensureProduct(productId);
  const existing = await getExistingReview(userId, productId);
  if (existing && existing.deletedAt === null) {
    return {
      eligible: false,
      reason: "ALREADY_REVIEWED",
      existingReview: await toOwnerReviewWithImages(existing, runtime),
      willRequireModeration: false,
    };
  }

  const eligibility = await resolveReviewEligibility(userId, productId);
  if (eligibility.purchase) {
    return {
      eligible: true,
      reason: null,
      existingReview: null,
      willRequireModeration: existing?.status === "HIDDEN",
    };
  }

  return {
    eligible: false,
    reason: eligibility.reason,
    existingReview: null,
    willRequireModeration: false,
  };
};

export const createReview = async (
  userId: number,
  productId: number,
  input: CreateReviewBody,
  runtime: ReviewImageRuntime = defaultReviewImageRuntime,
): Promise<OwnerReviewDto> => {
  await ensureProduct(productId);
  const existing = await getExistingReview(userId, productId);
  if (existing && existing.deletedAt === null)
    throw new AppError("You already reviewed this product", 409, "REVIEW_ALREADY_EXISTS");

  const eligibility = await resolveReviewEligibility(userId, productId);
  if (!eligibility.purchase) throw reviewNotEligible(eligibility.reason);
  const purchase = eligibility.purchase;

  await requirePublicName(userId, input.isAnonymous);

  if (existing?.deletedAt !== null && existing !== null) {
    const { count } = await prisma.review.updateMany({
      where: { id: existing.id, userId, deletedAt: { not: null } },
      data: {
        rating: input.rating,
        title: input.title?.trim() || null,
        content: input.content.trim(),
        isAnonymous: input.isAnonymous,
        orderDetailId: purchase.id,
        deletedAt: null,
        contentUpdatedAt: new Date(),
      },
    });
    if (count === 0)
      throw new AppError("You already reviewed this product", 409, "REVIEW_ALREADY_EXISTS");
    const reactivated = (await prisma.review.findUnique({
      where: { id: existing.id },
      select: ownerReviewSelect,
    })) as OwnerReviewRow;
    return toOwnerReviewWithImages(reactivated, runtime);
  }

  try {
    const review = await prisma.review.create({
      data: {
        userId,
        productId,
        orderDetailId: purchase.id,
        rating: input.rating,
        title: input.title?.trim() || null,
        content: input.content.trim(),
        isAnonymous: input.isAnonymous,
        status: existing?.status === "HIDDEN" ? "HIDDEN" : "PUBLISHED",
      },
      select: ownerReviewSelect,
    });
    return toOwnerReviewWithImages(review as OwnerReviewRow, runtime);
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError("You already reviewed this product", 409, "REVIEW_ALREADY_EXISTS");
    throw error;
  }
};

export const updateMyReview = async (
  userId: number,
  reviewId: number,
  input: UpdateReviewBody,
  runtime: ReviewImageRuntime = defaultReviewImageRuntime,
): Promise<OwnerReviewDto> => {
  const existing = (await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: ownerReviewSelect,
  })) as OwnerReviewRow | null;
  if (!existing) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
  if (existing.deletedAt !== null)
    throw new AppError("Review has been deleted", 409, "REVIEW_DELETED");
  const nextIsAnonymous = input.isAnonymous ?? existing.isAnonymous;
  await requirePublicName(userId, nextIsAnonymous);

  const review = await prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ id: number; deletedAt: Date | null }>>`
      SELECT id, deletedAt
      FROM reviews
      WHERE id = ${reviewId} AND userId = ${userId}
      FOR UPDATE
    `;
    const locked = lockedRows[0];
    if (!locked) throw new AppError("Review state has changed", 409, "REVIEW_STATE_CHANGED");
    if (locked.deletedAt !== null)
      throw new AppError("Review has been deleted", 409, "REVIEW_DELETED");

    const { count } = await tx.review.updateMany({
      where: { id: reviewId, userId, deletedAt: null },
      data: {
        ...(input.rating === undefined ? {} : { rating: input.rating }),
        ...(input.title === undefined ? {} : { title: input.title.trim() || null }),
        ...(input.content === undefined ? {} : { content: input.content.trim() }),
        ...(input.isAnonymous === undefined ? {} : { isAnonymous: input.isAnonymous }),
        contentUpdatedAt: new Date(),
      },
    });
    if (count === 0) throw new AppError("Review state has changed", 409, "REVIEW_STATE_CHANGED");

    return (await tx.review.findUnique({
      where: { id: reviewId },
      select: ownerReviewSelect,
    })) as OwnerReviewRow | null;
  });
  if (!review) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
  return toOwnerReviewWithImages(review, runtime);
};

export const deleteMyReview = async (
  userId: number,
  reviewId: number,
  runtime: ReviewImageRuntime = defaultReviewImageRuntime,
): Promise<void> => {
  const deletedImages = await prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<Array<{ id: number; deletedAt: Date | null }>>`
      SELECT id, deletedAt
      FROM reviews
      WHERE id = ${reviewId} AND userId = ${userId}
      FOR UPDATE
    `;
    const existing = lockedRows[0];
    if (!existing) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
    if (existing.deletedAt !== null) {
      await tx.reviewHelpful.deleteMany({ where: { reviewId } });
      return [];
    }
    const now = new Date();
    await tx.review.update({
      where: { id: reviewId, userId },
      data: { deletedAt: now },
    });
    await tx.reviewHelpful.deleteMany({ where: { reviewId } });
    await tx.reviewReply.updateMany({
      where: { reviewId, deletedAt: null },
      data: { deletedAt: now },
    });
    const images =
      (await tx.reviewImage.findMany({
        where: { reviewId, status: { in: ["PENDING", "READY"] }, deletedAt: null },
        select: { id: true, objectKey: true, status: true },
      })) ?? [];
    if (images.length)
      await tx.reviewImage.updateMany({
        where: { id: { in: images.map((image) => image.id) }, status: "READY" },
        data: { status: "DELETING", deletedAt: now },
      });
    if (images.length)
      await tx.reviewImage.updateMany({
        where: { id: { in: images.map((image) => image.id) }, status: "PENDING" },
        data: { deletedAt: now },
      });
    // PENDING uploads may still write after a DELETE acknowledgement. Their uploader
    // or reconciler retires them; an immediate-delete marker would suppress that purge.
    return images.filter((image) => image.status === "READY");
  });
  if (runtime.storage && deletedImages.length) {
    await Promise.all(
      deletedImages.map(async (image) => {
        try {
          await runtime.storage.deleteObject(image.objectKey);
          await prisma.reviewImage.update({
            where: { id: image.id },
            data: { storageDeletedAt: new Date() },
            select: { id: true },
          });
        } catch {
          // The DELETING row is retained for reconciliation.
        }
      }),
    );
  }
};

export const listAdminReviews = async (
  query: AdminListReviewsQuery,
  runtime: ReviewImageRuntime = defaultReviewImageRuntime,
): Promise<{ items: AdminReviewListItemDto[]; meta: ReturnType<typeof pageMeta> }> => {
  const where = adminReviewWhere(query);
  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      select: adminReviewSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return {
    items: await Promise.all(
      (rows as AdminReviewRow[]).map((row) => toAdminReviewWithImages(row, runtime)),
    ),
    meta: pageMeta(query, total),
  };
};

export const getAdminReviewSummary = async (): Promise<AdminReviewSummaryDto> => {
  const [totalReviews, publishedReviews, hiddenReviews, deletedReviews, groups] = await Promise.all(
    [
      prisma.review.count({ where: { deletedAt: null } }),
      prisma.review.count({ where: { status: "PUBLISHED", deletedAt: null } }),
      prisma.review.count({ where: { status: "HIDDEN", deletedAt: null } }),
      prisma.review.count({ where: { deletedAt: { not: null } } }),
      prisma.review.groupBy({
        by: ["rating"],
        where: { status: "PUBLISHED", deletedAt: null },
        _count: { _all: true },
      }),
    ],
  );
  const publicTotal = groups.reduce((sum, group) => sum + group._count._all, 0);
  const weighted = groups.reduce((sum, group) => sum + group.rating * group._count._all, 0);
  return {
    totalReviews,
    publishedReviews,
    hiddenReviews,
    deletedReviews,
    averageRating: publicTotal ? Math.round((weighted / publicTotal) * 10) / 10 : null,
  };
};

export const getAdminReview = async (
  reviewId: number,
  runtime: ReviewImageRuntime = defaultReviewImageRuntime,
): Promise<AdminReviewDetailDto> => {
  const review = (await prisma.review.findUnique({
    where: { id: reviewId },
    select: adminReviewSelect,
  })) as AdminReviewRow | null;
  if (!review) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
  return toAdminReviewWithImages(review, runtime);
};

export const moderateReview = async (
  adminId: number,
  reviewId: number,
  input: ModerateReviewBody,
): Promise<AdminReviewDetailDto> => {
  const current = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!current) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
  if (current.deletedAt !== null)
    throw new AppError("Review has been deleted", 409, "REVIEW_DELETED");
  await prisma.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<
      Array<{ id: number; status: "PUBLISHED" | "HIDDEN"; deletedAt: Date | null }>
    >`
      SELECT id, status, deletedAt
      FROM reviews
      WHERE id = ${reviewId}
      FOR UPDATE
    `;
    const locked = lockedRows[0];
    if (!locked) throw new AppError("Review state has changed", 409, "REVIEW_STATE_CHANGED");
    if (locked.deletedAt !== null)
      throw new AppError("Review has been deleted", 409, "REVIEW_DELETED");
    if (locked.status !== current.status)
      throw new AppError("Review state has changed", 409, "REVIEW_STATE_CHANGED");
    if (current.status === "PUBLISHED" && input.status === "PUBLISHED") return;

    const { count } = await tx.review.updateMany({
      where: { id: reviewId, deletedAt: null, status: current.status },
      data: {
        status: input.status,
        hiddenReason: input.status === "HIDDEN" ? input.reason! : null,
        moderatedById: adminId,
        moderatedAt: new Date(),
      },
    });
    if (count === 0) throw new AppError("Review state has changed", 409, "REVIEW_STATE_CHANGED");
  });
  return getAdminReview(reviewId);
};
