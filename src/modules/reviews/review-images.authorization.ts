import type { RequestHandler } from "express";
import { prisma } from "config/client";
import { AppError } from "lib/errors";

export const requireReviewImageOwner: RequestHandler = async (req, res, next) => {
  const reviewId = Number(req.params.id);
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId: req.auth!.id, deletedAt: null },
    select: { id: true },
  });
  if (!review) throw new AppError("Review not found", 404, "REVIEW_NOT_FOUND");
  res.locals.reviewImageReviewId = review.id;
  next();
};
