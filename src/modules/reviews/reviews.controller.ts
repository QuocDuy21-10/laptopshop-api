import type { RequestHandler } from "express";
import { type IdParams } from "lib/http";
import { listPublishedReviews, getPublishedReviewSummary } from "modules/reviews/reviews.service";
import {
  createReview,
  deleteMyReview,
  getAdminReview,
  getAdminReviewSummary,
  getReviewEligibility,
  listAdminReviews,
  moderateReview,
  updateMyReview,
} from "modules/reviews/reviews.service";
import type {
  AdminListReviewsQuery,
  CreateReviewBody,
  ListProductReviewsQuery,
  ModerateReviewBody,
  UpdateReviewBody,
} from "modules/reviews/reviews.schema";

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

export const updateMyReviewHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  res.json({ data: await updateMyReview(req.auth!.id, id, req.body as UpdateReviewBody) });
};

export const deleteMyReviewHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  await deleteMyReview(req.auth!.id, id);
  res.sendStatus(204);
};

export const listAdminReviewsHandler: RequestHandler = async (_req, res) => {
  const result = await listAdminReviews(res.locals.query as AdminListReviewsQuery);
  res.json({ data: result.items, meta: result.meta });
};

export const getAdminReviewSummaryHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getAdminReviewSummary() });
};

export const getAdminReviewHandler: RequestHandler = async (_req, res) => {
  const { id } = res.locals.params as IdParams;
  res.json({ data: await getAdminReview(id) });
};

export const moderateReviewHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  res.json({ data: await moderateReview(req.auth!.id, id, req.body as ModerateReviewBody) });
};
