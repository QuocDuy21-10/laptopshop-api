import { Router } from "express";
import { idParams } from "lib/http";
import { validate } from "middlewares/validate";
import {
  getProductReviewSummaryHandler,
  listProductReviewsHandler,
} from "modules/reviews/reviews.controller";
import { listProductReviewsQuery } from "modules/reviews/reviews.schema";

export const productReviewRoutes = Router();

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
