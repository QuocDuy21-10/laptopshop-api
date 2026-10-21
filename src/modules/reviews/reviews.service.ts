import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, isUniqueViolation, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import {
  publicReviewSelect,
  ownerReviewSelect,
  toOwnerReviewDto,
  toPublicReviewDto,
  type OwnerReviewDto,
  type ReviewEligibilityDto,
  type ReviewEligibilityReason,
  type PublicReviewDto,
  type PublicReviewRow,
  type ReviewSummaryDto,
} from "modules/reviews/reviews.mapper";
import type { ListProductReviewsQuery } from "modules/reviews/reviews.schema";
import type { CreateReviewBody } from "modules/reviews/reviews.schema";

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

const getExistingReview = (userId: number, productId: number) =>
  prisma.review.findUnique({
    where: { userId_productId: { userId, productId } },
    select: ownerReviewSelect,
  });

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
    items: (rows as PublicReviewRow[]).map(toPublicReviewDto),
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
      existingReview: toOwnerReviewDto(existing),
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

  if (!input.isAnonymous) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    if (!user?.fullName?.trim())
      throw new AppError(
        "A full name is required for a public review",
        409,
        "REVIEW_FULL_NAME_REQUIRED",
      );
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
    return toOwnerReviewDto(review);
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError("You already reviewed this product", 409, "REVIEW_ALREADY_EXISTS");
    throw error;
  }
};
