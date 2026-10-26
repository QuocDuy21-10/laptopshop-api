import multer from "multer";
import { Router } from "express";
import type { RequestHandler } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import { requireReviewImageOwner } from "modules/reviews/review-images.authorization";
import { createReviewImageHandlers } from "modules/reviews/reviews.controller";
import {
  reviewImageDeleteParams,
  reviewImageOrderBody,
  reviewImageParams,
} from "modules/reviews/reviews.schema";
import type { ReviewImageDeps } from "modules/reviews/review-images.service";

const reviewImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 3 },
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
