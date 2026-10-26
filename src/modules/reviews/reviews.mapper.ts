import { Prisma } from "@prisma/client";
import { reviewImageSelect, type ReviewImageRow } from "modules/reviews/review-images.mapper";

export type ReviewImageDto = {
  id: number;
  url: string;
  urlExpiresAt: string;
  mimeType: "image/webp";
  width: number;
  height: number;
  position: number;
};

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
  images: {
    where: { status: "READY", deletedAt: null },
    orderBy: { position: "asc" },
    select: reviewImageSelect,
  },
  reply: {
    where: { deletedAt: null },
    select: { content: true, createdAt: true, updatedAt: true },
  },
  _count: { select: { helpfulVotes: true } },
} satisfies Prisma.ReviewSelect;

export type PublicReviewRow = Prisma.ReviewGetPayload<{ select: typeof publicReviewSelect }>;

export const toPublicReviewDto = (
  review:
    | PublicReviewRow
    | (Omit<PublicReviewRow, "images" | "reply"> & {
        images?: ReviewImageRow[];
        reply?: PublicReviewRow["reply"];
      }),
  images: ReviewImageDto[] = [],
) => ({
  id: review.id,
  productId: review.productId,
  rating: review.rating,
  title: review.title,
  content: review.content,
  author: {
    name: review.isAnonymous ? "****" : review.user.fullName?.trim() || "Khách hàng LaptopShop",
    anonymous: review.isAnonymous,
  },
  verifiedPurchase: true,
  images,
  helpfulCount: review._count?.helpfulVotes ?? 0,
  createdAt: review.createdAt,
  updatedAt: review.contentUpdatedAt,
  officialReply: review.reply
    ? {
        content: review.reply.content,
        createdAt: review.reply.createdAt,
        updatedAt: review.reply.updatedAt,
      }
    : null,
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
  images: {
    where: { status: "READY", deletedAt: null },
    orderBy: { position: "asc" },
    select: reviewImageSelect,
  },
} satisfies Prisma.ReviewSelect;

export type OwnerReviewRow = Prisma.ReviewGetPayload<{ select: typeof ownerReviewSelect }>;

export const toOwnerReviewDto = (
  review: OwnerReviewRow | (Omit<OwnerReviewRow, "images"> & { images?: ReviewImageRow[] }),
  images: ReviewImageDto[] = [],
) => ({
  id: review.id,
  productId: review.productId,
  rating: review.rating,
  title: review.title,
  content: review.content,
  isAnonymous: review.isAnonymous,
  status: review.status,
  deletedAt: review.deletedAt,
  verifiedPurchase: true,
  images,
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

export const adminReviewSelect = {
  id: true,
  userId: true,
  productId: true,
  orderDetailId: true,
  rating: true,
  title: true,
  content: true,
  isAnonymous: true,
  status: true,
  deletedAt: true,
  createdAt: true,
  contentUpdatedAt: true,
  hiddenReason: true,
  moderatedAt: true,
  user: { select: { id: true, username: true, fullName: true } },
  product: { select: { id: true, name: true } },
  orderDetail: {
    select: {
      id: true,
      order: { select: { id: true, status: true, paymentStatus: true, completedAt: true } },
    },
  },
  moderatedBy: { select: { id: true, username: true, fullName: true } },
  reply: {
    select: {
      id: true,
      content: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      createdBy: { select: { id: true, username: true, fullName: true } },
      updatedBy: { select: { id: true, username: true, fullName: true } },
    },
  },
  images: {
    where: { status: "READY", deletedAt: null },
    orderBy: { position: "asc" },
    select: reviewImageSelect,
  },
  _count: { select: { helpfulVotes: true } },
} satisfies Prisma.ReviewSelect;

export type AdminReviewRow = Prisma.ReviewGetPayload<{ select: typeof adminReviewSelect }>;

export const toAdminReviewDto = (
  review:
    | AdminReviewRow
    | (Omit<AdminReviewRow, "images" | "reply"> & {
        images?: ReviewImageRow[];
        reply?: AdminReviewRow["reply"];
      }),
  images: ReviewImageDto[] = [],
) => ({
  id: review.id,
  rating: review.rating,
  title: review.title,
  content: review.content,
  isAnonymous: review.isAnonymous,
  status: review.status,
  deletedAt: review.deletedAt,
  createdAt: review.createdAt,
  contentUpdatedAt: review.contentUpdatedAt,
  hiddenReason: review.hiddenReason,
  moderatedAt: review.moderatedAt,
  author: review.user,
  product: review.product,
  purchase: {
    orderId: review.orderDetail.order.id,
    orderDetailId: review.orderDetail.id,
    status: review.orderDetail.order.status,
    paymentStatus: review.orderDetail.order.paymentStatus,
    completedAt: review.orderDetail.order.completedAt,
  },
  moderatedBy: review.moderatedBy,
  images,
  helpfulCount: review._count?.helpfulVotes ?? 0,
  officialReply:
    review.reply && review.reply.deletedAt === null
      ? {
          id: review.reply.id,
          content: review.reply.content,
          createdAt: review.reply.createdAt,
          updatedAt: review.reply.updatedAt,
          createdBy: review.reply.createdBy,
          updatedBy: review.reply.updatedBy,
        }
      : null,
});

export type AdminReviewListItemDto = ReturnType<typeof toAdminReviewDto>;
export type AdminReviewDetailDto = ReturnType<typeof toAdminReviewDto>;

export type AdminReviewSummaryDto = {
  totalReviews: number;
  publishedReviews: number;
  hiddenReviews: number;
  deletedReviews: number;
  averageRating: number | null;
};

export type ReviewSummaryDto = {
  productId: number;
  averageRating: number | null;
  totalReviews: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
};
