import { prisma } from "config/client";

export type ProductReviewSummary = {
  averageRating: number | null;
  totalReviews: number;
};

export const emptyProductReviewSummary: ProductReviewSummary = {
  averageRating: null,
  totalReviews: 0,
};

const roundRating = (rating: number | null): number | null =>
  rating === null ? null : Math.round(rating * 10) / 10;

export const getReviewStatsForProductIds = async (productIds: number[]) => {
  if (!productIds.length) return new Map<number, ProductReviewSummary>();

  const rows = await prisma.review.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, status: "PUBLISHED", deletedAt: null },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const byProductId = new Map(
    rows.map(
      (row) =>
        [
          row.productId,
          {
            averageRating: roundRating(row._avg.rating),
            totalReviews: row._count._all,
          },
        ] as const,
    ),
  );

  return new Map(
    productIds.map(
      (productId) =>
        [productId, byProductId.get(productId) ?? { ...emptyProductReviewSummary }] as const,
    ),
  );
};
