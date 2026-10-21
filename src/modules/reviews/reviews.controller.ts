import type { RequestHandler } from "express";
import { type IdParams } from "lib/http";
import { listPublishedReviews, getPublishedReviewSummary } from "modules/reviews/reviews.service";
import { createReview, getReviewEligibility } from "modules/reviews/reviews.service";
import type { CreateReviewBody, ListProductReviewsQuery } from "modules/reviews/reviews.schema";

export const listProductReviewsHandler: RequestHandler = async (_req, res) => {
  const { id } = res.locals.params as { id: number };
  const result = await listPublishedReviews(id, res.locals.query as ListProductReviewsQuery);
  res.json({ data: result.items, meta: result.meta });
};

export const getProductReviewSummaryHandler: RequestHandler = async (_req, res) => {
  const { id } = res.locals.params as { id: number };
  res.json({ data: await getPublishedReviewSummary(id) });
};

export const getReviewEligibilityHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  res.json({ data: await getReviewEligibility(req.auth!.id, id) });
};

export const createReviewHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  res
    .status(201)
    .json({ data: await createReview(req.auth!.id, id, req.body as CreateReviewBody) });
};
