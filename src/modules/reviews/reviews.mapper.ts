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

export const ownerReviewSelect = {
  id: true,
  productId: true,
  rating: true,
  title: true,
  content: true,
  isAnonymous: true,
  status: true,
  deletedAt: true,
  createdAt: true,
  contentUpdatedAt: true,
} satisfies Prisma.ReviewSelect;

export type OwnerReviewRow = Prisma.ReviewGetPayload<{ select: typeof ownerReviewSelect }>;

export const toOwnerReviewDto = (review: OwnerReviewRow) => ({
  id: review.id,
  productId: review.productId,
  rating: review.rating,
  title: review.title,
  content: review.content,
  isAnonymous: review.isAnonymous,
  status: review.status,
  deletedAt: review.deletedAt,
  verifiedPurchase: true,
  createdAt: review.createdAt,
  updatedAt: review.contentUpdatedAt,
});

export type OwnerReviewDto = ReturnType<typeof toOwnerReviewDto>;

export type ReviewEligibilityReason =
  "NOT_PURCHASED" | "ORDER_NOT_COMPLETED" | "PAYMENT_NOT_CONFIRMED" | "ALREADY_REVIEWED";

export type ReviewEligibilityDto = {
  eligible: boolean;
  reason: ReviewEligibilityReason | null;
  existingReview: OwnerReviewDto | null;
  willRequireModeration: boolean;
};

export type ReviewSummaryDto = {
  productId: number;
  averageRating: number | null;
  totalReviews: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
};
