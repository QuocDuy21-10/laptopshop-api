import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import {
  publicReviewSelect,
  toPublicReviewDto,
  type PublicReviewDto,
  type PublicReviewRow,
  type ReviewSummaryDto,
} from "modules/reviews/reviews.mapper";
import type { ListProductReviewsQuery } from "modules/reviews/reviews.schema";

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
