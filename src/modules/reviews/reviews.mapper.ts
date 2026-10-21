import { Prisma } from "@prisma/client";

export const publicReviewSelect = {
  id: true,
  productId: true,
  rating: true,
  title: true,
  content: true,
  isAnonymous: true,
  createdAt: true,
  contentUpdatedAt: true,
  user: { select: { fullName: true } },
} satisfies Prisma.ReviewSelect;

export type PublicReviewRow = Prisma.ReviewGetPayload<{ select: typeof publicReviewSelect }>;

export const toPublicReviewDto = (review: PublicReviewRow) => ({
  id: review.id,
  productId: review.productId,
  rating: review.rating,
  title: review.title,
  content: review.content,
  author: {
    name: review.isAnonymous ? "****" : (review.user.fullName ?? "Khách hàng LaptopShop"),
    anonymous: review.isAnonymous,
  },
  verifiedPurchase: true,
  createdAt: review.createdAt,
  updatedAt: review.contentUpdatedAt,
});

export type PublicReviewDto = ReturnType<typeof toPublicReviewDto>;

export type ReviewSummaryDto = {
  productId: number;
  averageRating: number | null;
  totalReviews: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
};
