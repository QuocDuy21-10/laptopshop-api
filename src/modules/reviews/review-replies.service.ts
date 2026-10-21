import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError } from "lib/errors";
import type { PutReviewReplyBody } from "modules/reviews/reviews.schema";

const replySelect = {
  id: true,
  reviewId: true,
  content: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdBy: { select: { id: true, username: true, fullName: true } },
  updatedBy: { select: { id: true, username: true, fullName: true } },
} satisfies Prisma.ReviewReplySelect;

export type AdminReviewReplyDto = Prisma.ReviewReplyGetPayload<{ select: typeof replySelect }>;

const ensureAdminReplyReview = async (tx: Prisma.TransactionClient, reviewId: number) => {
  const rows = await tx.$queryRaw<Array<{ id: number; status: "PUBLISHED" | "HIDDEN"; deletedAt: Date | null }>>`
    SELECT id, status, deletedAt
    FROM reviews
    WHERE id = ${reviewId}
    FOR UPDATE
  `;
  const review = rows[0];
  if (!review) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
  if (review.deletedAt !== null)
    throw new AppError("Review has been deleted", 409, "REVIEW_DELETED");
  return review;
};

export const putOfficialReply = async (
  adminId: number,
  reviewId: number,
  input: PutReviewReplyBody,
): Promise<AdminReviewReplyDto> => {
  const content = input.content.trim();
  await prisma.$transaction(async (tx) => {
    await ensureAdminReplyReview(tx, reviewId);
    await tx.reviewReply.upsert({
      where: { reviewId },
      create: { reviewId, content, createdById: adminId, updatedById: adminId },
      update: { content, updatedById: adminId, deletedAt: null },
    });
  });
  return (await prisma.reviewReply.findUniqueOrThrow({ where: { reviewId }, select: replySelect })) as AdminReviewReplyDto;
};

export const deleteOfficialReply = async (adminId: number, reviewId: number): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    await ensureAdminReplyReview(tx, reviewId);
    await tx.reviewReply.updateMany({
      where: { reviewId, deletedAt: null },
      data: { deletedAt: new Date(), updatedById: adminId },
    });
  });
};
