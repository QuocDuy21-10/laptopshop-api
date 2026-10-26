import { Router, type RequestHandler } from "express";
import { idParams } from "lib/http";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  createReviewHelpfulHandlers,
  createReviewHandlers,
} from "modules/reviews/reviews.controller";
import type { ReviewImageRuntime } from "modules/reviews/review-image-runtime";
import {
  adminListReviewsQuery,
  createReviewBody,
  listProductReviewsQuery,
  moderateReviewBody,
  updateReviewBody,
  helpfulReviewIdsQuery,
  putReviewReplyBody,
} from "modules/reviews/reviews.schema";

export const createReviewHelpfulRoutes = (limiter?: RequestHandler) => {
  const router = Router();
  const handlers = createReviewHelpfulHandlers();
  router.get("/helpful", authenticate, validate({ query: helpfulReviewIdsQuery }), handlers.list);
  const mutationMiddleware = [authenticate, ...(limiter ? [limiter] : [])];
  router.put("/:id/helpful", ...mutationMiddleware, validate({ params: idParams }), handlers.mark);
  router.delete(
    "/:id/helpful",
    ...mutationMiddleware,
    validate({ params: idParams }),
    handlers.unmark,
  );
  return router;
};

export const createProductReviewRoutes = (
  runtime?: ReviewImageRuntime,
  limiter?: RequestHandler,
) => {
  const router = Router();
  const handlers = createReviewHandlers(runtime);
  router.get(
    "/:id/reviews/eligibility",
    authenticate,
    validate({ params: idParams }),
    handlers.getReviewEligibility,
  );
  router.post(
    "/:id/reviews",
    authenticate,
    ...(limiter ? [limiter] : []),
    validate({ params: idParams, body: createReviewBody }),
    handlers.createReview,
  );
  router.get(
    "/:id/reviews/summary",
    validate({ params: idParams }),
    handlers.getProductReviewSummary,
  );
  router.get(
    "/:id/reviews",
    validate({ params: idParams, query: listProductReviewsQuery }),
    handlers.listProductReviews,
  );
  return router;
};

export const createReviewRoutes = (runtime?: ReviewImageRuntime, limiter?: RequestHandler) => {
  const router = Router();
  const handlers = createReviewHandlers(runtime);
  router.patch(
    "/:id",
    authenticate,
    ...(limiter ? [limiter] : []),
    validate({ params: idParams, body: updateReviewBody }),
    handlers.updateMyReview,
  );
  router.delete(
    "/:id",
    authenticate,
    ...(limiter ? [limiter] : []),
    validate({ params: idParams }),
    handlers.deleteMyReview,
  );
  return router;
};

export const createAdminReviewRoutes = (runtime?: ReviewImageRuntime) => {
  const router = Router();
  const handlers = createReviewHandlers(runtime);
  router.get("/summary", handlers.getAdminReviewSummary);
  router.get("/", validate({ query: adminListReviewsQuery }), handlers.listAdminReviews);
  router.get("/:id", validate({ params: idParams }), handlers.getAdminReview);
  router.patch(
    "/:id/moderation",
    validate({ params: idParams, body: moderateReviewBody }),
    handlers.moderateReview,
  );
  router.put(
    "/:id/reply",
    validate({ params: idParams, body: putReviewReplyBody }),
    handlers.putOfficialReply,
  );
  router.delete("/:id/reply", validate({ params: idParams }), handlers.deleteOfficialReply);
  return router;
};

export const productReviewRoutes = createProductReviewRoutes();
export const reviewRoutes = createReviewRoutes();
export const adminReviewRoutes = createAdminReviewRoutes();
