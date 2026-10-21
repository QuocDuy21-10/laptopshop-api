import { Router } from "express";
import { idParams } from "lib/http";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  createReviewHandler,
  getProductReviewSummaryHandler,
  getReviewEligibilityHandler,
  listProductReviewsHandler,
} from "modules/reviews/reviews.controller";
import { createReviewBody, listProductReviewsQuery } from "modules/reviews/reviews.schema";

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
export const adminReviewRoutes = Router();
