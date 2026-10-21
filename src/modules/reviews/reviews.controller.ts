import type { Request, RequestHandler, Response } from "express";
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
  HelpfulReviewIdsQuery,
} from "modules/reviews/reviews.schema";
import {
  listMyHelpfulReviewIds,
  markReviewHelpful,
  unmarkReviewHelpful,
} from "modules/reviews/review-helpful.service";
import type { ReviewImageDeps } from "modules/reviews/review-images.service";
import {
  addReviewImages,
  deleteReviewImage,
  reorderReviewImages,
} from "modules/reviews/review-images.service";
import type { ReviewImageOrderBody } from "modules/reviews/reviews.schema";

export const createReviewImageHandlers = (deps: ReviewImageDeps) => ({
  add: async (req: Request, res: Response) => {
    const reviewId = Number(res.locals.reviewImageReviewId);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    res.status(201).json({ data: await addReviewImages(deps, req.auth!.id, reviewId, files) });
  },
  reorder: async (req: Request, res: Response) => {
    const reviewId = Number(res.locals.reviewImageReviewId);
    const { imageIds } = req.body as ReviewImageOrderBody;
    res.json({ data: await reorderReviewImages(deps, req.auth!.id, reviewId, imageIds) });
  },
  remove: async (req: Request, res: Response) => {
    const reviewId = Number(res.locals.reviewImageReviewId);
    await deleteReviewImage(deps, req.auth!.id, reviewId, Number(req.params.imageId));
    res.sendStatus(204);
  },
});

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

export const createReviewHelpfulHandlers = () => ({
  list: async (req: Request, res: Response) => {
    const { reviewIds } = res.locals.query as HelpfulReviewIdsQuery;
    res.json({ data: { reviewIds: await listMyHelpfulReviewIds(req.auth!.id, reviewIds) } });
  },
  mark: async (req: Request, res: Response) => {
    const { id } = res.locals.params as IdParams;
    res.json({ data: await markReviewHelpful(req.auth!.id, id) });
  },
  unmark: async (req: Request, res: Response) => {
    const { id } = res.locals.params as IdParams;
    res.json({ data: await unmarkReviewHelpful(req.auth!.id, id) });
  },
});
