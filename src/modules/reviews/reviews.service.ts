import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { env } from "config/env";
import { AppError, isUniqueViolation, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
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
import { createReviewImageStorage } from "lib/storage/s3-review-image-storage";
import type { ReviewImageRow } from "modules/reviews/review-images.mapper";
import type { ListProductReviewsQuery } from "modules/reviews/reviews.schema";
import type {
  AdminListReviewsQuery,
  CreateReviewBody,
  ModerateReviewBody,
  UpdateReviewBody,
} from "modules/reviews/reviews.schema";

const reviewImageStorage = createReviewImageStorage(env);

const signReviewImages = async (
  images: ReviewImageRow[] | undefined,
): Promise<ReviewImageDto[]> => {
  if (!reviewImageStorage || !images?.length) return [];
  return Promise.all(
    images.map(async (image) => ({
      id: image.id,
      url: await reviewImageStorage.getSignedReadUrl(
        image.objectKey,
        env.REVIEW_IMAGE_URL_TTL_SECONDS,
      ),
      mimeType: image.mimeType as "image/webp",
      width: image.width,
      height: image.height,
      position: image.position,
    })),
  );
};

const toPublicReviewWithImages = async (row: PublicReviewRow) =>
  toPublicReviewDto(row, await signReviewImages(row.images));
const toOwnerReviewWithImages = async (row: OwnerReviewRow) =>
  toOwnerReviewDto(row, await signReviewImages(row.images));
const toAdminReviewWithImages = async (row: AdminReviewRow) =>
  toAdminReviewDto(row, await signReviewImages(row.images));

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

const purchaseRows = (userId: number, productId: number) =>
  prisma.orderDetail.findMany({
    where: { productId, order: { userId } },
    select: {
      id: true,
      orderId: true,
      order: { select: { status: true, paymentStatus: true, completedAt: true } },
    },
    orderBy: { id: "desc" },
  });

const reviewOrderBy = (
  sort: ListProductReviewsQuery["sort"],
): Prisma.ReviewOrderByWithRelationInput[] => {
  if (sort === "highest") return [{ rating: "desc" }, { createdAt: "desc" }, { id: "desc" }];
  if (sort === "lowest") return [{ rating: "asc" }, { createdAt: "desc" }, { id: "desc" }];
  return [{ createdAt: "desc" }, { id: "desc" }];
};

const adminReviewWhere = (query: AdminListReviewsQuery): Prisma.ReviewWhereInput => ({
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
  ...(query.from || query.to
    ? {
        createdAt: {
          ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
          ...(query.to ? { lt: new Date(`${query.to}T23:59:59.999Z`) } : {}),
        },
      }
    : {}),
});

export const listPublishedReviews = async (
  productId: number,
  query: ListProductReviewsQuery,
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
    items: await Promise.all((rows as PublicReviewRow[]).map(toPublicReviewWithImages)),
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
): Promise<ReviewEligibilityDto> => {
  await ensureProduct(productId);
  const existing = await getExistingReview(userId, productId);
  if (existing && existing.deletedAt === null) {
    return {
      eligible: false,
      reason: "ALREADY_REVIEWED",
      existingReview: await toOwnerReviewWithImages(existing),
      willRequireModeration: false,
    };
  }

  const purchases = await purchaseRows(userId, productId);
  const eligiblePurchase = purchases.find(
    (item) => item.order.status === "COMPLETED" && item.order.paymentStatus === "PAYMENT_SUCCESS",
  );
  if (eligiblePurchase) {
    return {
      eligible: true,
      reason: null,
      existingReview: null,
      willRequireModeration: existing?.status === "HIDDEN",
    };
  }

  const reason: Exclude<ReviewEligibilityReason, "ALREADY_REVIEWED"> =
    purchases.length === 0
      ? "NOT_PURCHASED"
      : purchases.some((item) => item.order.status === "COMPLETED")
        ? "PAYMENT_NOT_CONFIRMED"
        : "ORDER_NOT_COMPLETED";
  return { eligible: false, reason, existingReview: null, willRequireModeration: false };
};

export const createReview = async (
  userId: number,
  productId: number,
  input: CreateReviewBody,
): Promise<OwnerReviewDto> => {
  await ensureProduct(productId);
  const existing = await getExistingReview(userId, productId);
  if (existing && existing.deletedAt === null)
    throw new AppError("You already reviewed this product", 409, "REVIEW_ALREADY_EXISTS");

  const purchase = await prisma.orderDetail.findFirst({
    where: {
      productId,
      order: { userId, status: "COMPLETED", paymentStatus: "PAYMENT_SUCCESS" },
    },
    select: { id: true },
    orderBy: { id: "desc" },
  });
  if (!purchase) throw reviewNotEligible("ORDER_NOT_COMPLETED");

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
    return toOwnerReviewWithImages(reactivated);
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
    return toOwnerReviewWithImages(review as OwnerReviewRow);
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
): Promise<OwnerReviewDto> => {
  const existing = (await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: ownerReviewSelect,
  })) as OwnerReviewRow | null;
  if (!existing) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
  if (existing.deletedAt !== null)
    throw new AppError("Review has been deleted", 409, "REVIEW_DELETED");
  if (input.isAnonymous === false) await requirePublicName(userId, false);

  const review = await prisma.review.update({
    where: { id: reviewId, userId },
    data: {
      ...(input.rating === undefined ? {} : { rating: input.rating }),
      ...(input.title === undefined ? {} : { title: input.title.trim() || null }),
      ...(input.content === undefined ? {} : { content: input.content.trim() }),
      ...(input.isAnonymous === undefined ? {} : { isAnonymous: input.isAnonymous }),
      contentUpdatedAt: new Date(),
    },
    select: ownerReviewSelect,
  });
  return toOwnerReviewWithImages(review as OwnerReviewRow);
};

export const deleteMyReview = async (userId: number, reviewId: number): Promise<void> => {
  const deletedImages = await prisma.$transaction(async (tx) => {
    const existing = await tx.review.findFirst({
      where: { id: reviewId, userId },
      select: { id: true, deletedAt: true },
    });
    if (!existing) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
    if (existing.deletedAt !== null) return [];
    const now = new Date();
    await tx.review.update({
      where: { id: reviewId, userId },
      data: { deletedAt: now },
    });
    const images =
      (await tx.reviewImage.findMany({
        where: { reviewId, status: { in: ["PENDING", "READY"] }, deletedAt: null },
        select: { id: true, objectKey: true },
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
    return images;
  });
  if (reviewImageStorage && deletedImages.length) {
    await Promise.all(
      deletedImages.map(async (image) => {
        try {
          await reviewImageStorage.deleteObject(image.objectKey);
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
    items: await Promise.all((rows as AdminReviewRow[]).map(toAdminReviewWithImages)),
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

export const getAdminReview = async (reviewId: number): Promise<AdminReviewDetailDto> => {
  const review = (await prisma.review.findUnique({
    where: { id: reviewId },
    select: adminReviewSelect,
  })) as AdminReviewRow | null;
  if (!review) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
  return toAdminReviewWithImages(review);
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
  if (current.status === "PUBLISHED" && input.status === "PUBLISHED")
    return getAdminReview(reviewId);
  await prisma.review.update({
    where: { id: reviewId },
    data: {
      status: input.status,
      hiddenReason: input.status === "HIDDEN" ? input.reason! : null,
      moderatedById: adminId,
      moderatedAt: new Date(),
    },
  });
  return getAdminReview(reviewId);
};
