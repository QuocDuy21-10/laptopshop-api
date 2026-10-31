import multer from "multer";
import { Router } from "express";
import type { RequestHandler } from "express";

import { validate } from "middlewares/validate";
import { authenticate } from "middlewares/authenticate";
import {
  reviewImageDeleteParams,
  reviewImageOrderBody,
  reviewImageParams,
} from "modules/reviews/reviews.schema";
import { createReviewImageHandlers } from "modules/reviews/reviews.controller";
import type { ReviewImageDeps } from "modules/reviews/review-images.service";
import { MAX_REVIEW_IMAGE_INPUT_BYTES } from "modules/reviews/review-images.constants";
import { requireReviewImageOwner } from "modules/reviews/review-images.authorization";

const reviewImageUpload = multer({
  storage: multer.memoryStorage(),
  // Busboy emits "limit" on equality; the processor enforces the inclusive limit.
  limits: { fileSize: MAX_REVIEW_IMAGE_INPUT_BYTES + 1, files: 3 },
});

export const createReviewImageRoutes = (
  deps: ReviewImageDeps,
  limiter?: RequestHandler,
  mutationLimiter?: RequestHandler,
) => {
  const router = Router();
  const handlers = createReviewImageHandlers(deps);
  const authAndLimit = [authenticate, ...(limiter ? [limiter] : [])];
  const syncAuthAndLimit = [authenticate, ...(mutationLimiter ? [mutationLimiter] : [])];

  router.post(
    "/:id/images",
    ...authAndLimit,
    ...(mutationLimiter ? [mutationLimiter] : []),
    validate({ params: reviewImageParams }),
    requireReviewImageOwner,
    reviewImageUpload.array("images", 3),
    handlers.add,
  );
  router.put(
    "/:id/images/sync",
    ...syncAuthAndLimit,
    validate({ params: reviewImageParams }),
    requireReviewImageOwner,
    reviewImageUpload.array("files", 3),
    handlers.sync,
  );
  router.get(
    "/:id/images/sync",
    ...authAndLimit,
    validate({ params: reviewImageParams }),
    requireReviewImageOwner,
    handlers.syncStatus,
  );
  router.patch(
    "/:id/images/order",
    ...authAndLimit,
    ...(mutationLimiter ? [mutationLimiter] : []),
    validate({ params: reviewImageParams, body: reviewImageOrderBody }),
    requireReviewImageOwner,
    handlers.reorder,
  );
  router.delete(
    "/:id/images/:imageId",
    ...authAndLimit,
    ...(mutationLimiter ? [mutationLimiter] : []),
    validate({ params: reviewImageDeleteParams }),
    requireReviewImageOwner,
    handlers.remove,
  );
  return router;
};
