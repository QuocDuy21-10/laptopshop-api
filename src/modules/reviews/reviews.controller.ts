import type { RequestHandler } from "express";
import { listPublishedReviews, getPublishedReviewSummary } from "modules/reviews/reviews.service";
import type { ListProductReviewsQuery } from "modules/reviews/reviews.schema";

export const listProductReviewsHandler: RequestHandler = async (_req, res) => {
  const { id } = res.locals.params as { id: number };
  const result = await listPublishedReviews(id, res.locals.query as ListProductReviewsQuery);
  res.json({ data: result.items, meta: result.meta });
};

export const getProductReviewSummaryHandler: RequestHandler = async (_req, res) => {
  const { id } = res.locals.params as { id: number };
  res.json({ data: await getPublishedReviewSummary(id) });
};
