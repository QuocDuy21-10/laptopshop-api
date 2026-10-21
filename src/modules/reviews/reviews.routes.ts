import { Router, type RequestHandler } from "express";
import { idParams } from "lib/http";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  createReviewHandler,
  getAdminReviewHandler,
  getAdminReviewSummaryHandler,
  getProductReviewSummaryHandler,
  getReviewEligibilityHandler,
  listAdminReviewsHandler,
  listProductReviewsHandler,
  moderateReviewHandler,
  updateMyReviewHandler,
  deleteMyReviewHandler,
  createReviewHelpfulHandlers,
  putOfficialReplyHandler,
  deleteOfficialReplyHandler,
} from "modules/reviews/reviews.controller";
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

export const productReviewRoutes = Router();

productReviewRoutes.get(
  "/:id/reviews/eligibility",
  authenticate,
  validate({ params: idParams }),
  getReviewEligibilityHandler,
);
productReviewRoutes.post(
  "/:id/reviews",
  authenticate,
  validate({ params: idParams, body: createReviewBody }),
  createReviewHandler,
);
productReviewRoutes.get(
  "/:id/reviews/summary",
  validate({ params: idParams }),
  getProductReviewSummaryHandler,
);
productReviewRoutes.get(
  "/:id/reviews",
  validate({ params: idParams, query: listProductReviewsQuery }),
  listProductReviewsHandler,
);

export const reviewRoutes = Router();
reviewRoutes.patch(
  "/:id",
  authenticate,
  validate({ params: idParams, body: updateReviewBody }),
  updateMyReviewHandler,
);
reviewRoutes.delete("/:id", authenticate, validate({ params: idParams }), deleteMyReviewHandler);
export const adminReviewRoutes = Router();
adminReviewRoutes.get("/summary", getAdminReviewSummaryHandler);
adminReviewRoutes.get("/", validate({ query: adminListReviewsQuery }), listAdminReviewsHandler);
adminReviewRoutes.get("/:id", validate({ params: idParams }), getAdminReviewHandler);
adminReviewRoutes.patch(
  "/:id/moderation",
  validate({ params: idParams, body: moderateReviewBody }),
  moderateReviewHandler,
);
adminReviewRoutes.put(
  "/:id/reply",
  validate({ params: idParams, body: putReviewReplyBody }),
  putOfficialReplyHandler,
);
adminReviewRoutes.delete(
  "/:id/reply",
  validate({ params: idParams }),
  deleteOfficialReplyHandler,
);
