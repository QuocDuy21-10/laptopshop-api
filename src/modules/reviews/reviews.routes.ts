import { Router } from "express";
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
} from "modules/reviews/reviews.controller";
import {
  adminListReviewsQuery,
  createReviewBody,
  listProductReviewsQuery,
  moderateReviewBody,
  updateReviewBody,
} from "modules/reviews/reviews.schema";

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
