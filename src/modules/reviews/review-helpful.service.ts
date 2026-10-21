import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, isUniqueViolation } from "lib/errors";

const publicReviewWhere = {
  status: "PUBLISHED" as const,
  deletedAt: null,
};

const getPublicReview = async (client: Prisma.TransactionClient, reviewId: number) => {
  const [review] = await client.$queryRaw<Array<{ id: number; userId: number }>>(Prisma.sql`
    SELECT id, userId
    FROM reviews
    WHERE id = ${reviewId} AND status = 'PUBLISHED' AND deletedAt IS NULL
    FOR UPDATE
  `);
  if (!review) throw new AppError("Review not found", 404, "REVIEW_NOT_PUBLIC");
  return review;
};

export const listMyHelpfulReviewIds = async (userId: number, reviewIds: number[]) => {
  const rows = await prisma.reviewHelpful.findMany({
    where: {
      userId,
      reviewId: { in: reviewIds },
      review: publicReviewWhere,
    },
    select: { reviewId: true },
  });
  return rows.map((row) => row.reviewId);
};

export const markReviewHelpful = async (userId: number, reviewId: number) => {
  return prisma.$transaction(async (tx) => {
    const review = await getPublicReview(tx, reviewId);
    if (review.userId === userId) {
      throw new AppError("You cannot vote for your own review", 409, "REVIEW_HELPFUL_SELF_VOTE");
    }
    try {
      await tx.reviewHelpful.create({ data: { reviewId, userId } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    const helpfulCount = await tx.reviewHelpful.count({ where: { reviewId } });
    return { reviewId, helpfulCount, helpful: true as const };
  });
};

export const unmarkReviewHelpful = async (userId: number, reviewId: number) => {
  return prisma.$transaction(async (tx) => {
    await getPublicReview(tx, reviewId);
    await tx.reviewHelpful.deleteMany({ where: { reviewId, userId } });
    const helpfulCount = await tx.reviewHelpful.count({ where: { reviewId } });
    return { reviewId, helpfulCount, helpful: false as const };
  });
};
