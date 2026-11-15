// import data type
/// <reference path="./types/index.d.ts" />

import hpp from "hpp";
import cors from "cors";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import { type Store } from "express-rate-limit";

import { env } from "config/env";
import { logger } from "lib/logger";
import { createApiV1Router } from "routes/index";
import { registerHealthRoutes } from "routes/health";
import { discardFailedUpload } from "middlewares/multer";
import { registerMediaRoutes } from "routes/media-images";
import { applySecurity } from "middlewares/security";
import { createLimiters } from "middlewares/rate-limit";
import { configureMediaStorage } from "lib/storage/media-images";
import type { ObjectStorage } from "lib/storage/object-storage";
import { errorHandler, notFoundHandler } from "middlewares/error.middleware";
import { createS3ObjectStorage } from "lib/storage/s3-object-storage";
import {
  createAdvisorService,
  priceAdvisorCandidates,
  type AdvisorService,
} from "modules/advisor/advisor.service";
import { paymentWebhookRoutes } from "modules/payments/payments.routes";
import { PrismaAdvisorRepository } from "modules/advisor/advisor.repository";
import type { ReviewImageDeps } from "modules/reviews/review-images.service";
import type { AttachmentDeps } from "modules/after-sales/after-sales.attachments";

export interface AppDeps {
  limitStores?: {
    global?: Store;
    auth?: Store;
    advisor?: Store;
    reviewImages?: Store;
    reviewHelpful?: Store;
    reviewMutations?: Store;
    afterSalesImages?: Store;
    newsletter?: Store;
  };
  advisor?: { service: AdvisorService; identitySecret: string };
  reviewImages?: ReviewImageDeps | null;
  afterSalesAttachments?: AttachmentDeps | null;
  // undefined builds it from MEDIA_* env; null keeps uploads under public/
  mediaImages?: ObjectStorage | null;
  readyChecks?: Array<() => Promise<unknown>>;
  // hook for optional features that must register before the final 404/error handlers
  registerExtras?: (app: Express) => void;
}

export const createApp = (deps: AppDeps = {}): Express => {
  const app = express();

  app.set("trust proxy", 1);
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/healthz" } }));
  applySecurity(app);
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));

  const mediaImages =
    deps.mediaImages !== undefined
      ? deps.mediaImages
      : createS3ObjectStorage({
          enabled: env.MEDIA_IMAGES_ENABLED,
          endpoint: env.MEDIA_S3_ENDPOINT,
          region: env.MEDIA_S3_REGION,
          bucket: env.MEDIA_S3_BUCKET,
          accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID,
          secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.MEDIA_S3_FORCE_PATH_STYLE,
        });
  // the upload middleware and services are module-level, so they read the storage chosen here
  configureMediaStorage(mediaImages);

  // health + uploaded images before the limiter so they do not hit Redis
  registerHealthRoutes(app, deps.readyChecks ?? []);
  app.use(express.static("public"));
  if (mediaImages) registerMediaRoutes(app);

  // Provider signatures are calculated over raw bytes; this route must precede express.json().
  app.use("/api/v1/webhooks/payments", paymentWebhookRoutes);

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(hpp());

  const {
    globalLimiter,
    authLimiter,
    advisorLimiter,
    reviewImagesLimiter,
    reviewHelpfulLimiter,
    reviewMutationLimiter,
    afterSalesImagesLimiter,
    newsletterLimiter,
  } = createLimiters(deps.limitStores);
  app.use(globalLimiter);
  app.post(
    [
      "/api/v1/auth/login",
      "/api/v1/auth/register",
      "/api/v1/auth/forgot-password",
      "/api/v1/auth/reset-password",
    ],
    authLimiter,
  );
  app.post("/api/v1/newsletter/subscribe", newsletterLimiter);

  const advisor =
    deps.advisor ??
    ({
      service: createAdvisorService({
        repository: new PrismaAdvisorRepository(),
        priceCandidates: priceAdvisorCandidates,
        candidateBatchSize: env.ADVISOR_CANDIDATE_BATCH_SIZE,
      }),
      identitySecret: env.JWT_SECRET,
    } as const);
  const reviewImages =
    deps.reviewImages !== undefined
      ? deps.reviewImages
      : (() => {
          const storage = createS3ObjectStorage({
            enabled: env.REVIEW_IMAGES_ENABLED,
            endpoint: env.REVIEW_IMAGE_S3_ENDPOINT,
            region: env.REVIEW_IMAGE_S3_REGION,
            bucket: env.REVIEW_IMAGE_S3_BUCKET,
            accessKeyId: env.REVIEW_IMAGE_S3_ACCESS_KEY_ID,
            secretAccessKey: env.REVIEW_IMAGE_S3_SECRET_ACCESS_KEY,
            forcePathStyle: env.REVIEW_IMAGE_S3_FORCE_PATH_STYLE,
          });
          return storage ? { storage, urlTtlSeconds: env.REVIEW_IMAGE_URL_TTL_SECONDS } : null;
        })();
  const afterSalesAttachments =
    deps.afterSalesAttachments !== undefined
      ? deps.afterSalesAttachments
      : (() => {
          const storage = createS3ObjectStorage({
            enabled: env.AFTER_SALES_IMAGES_ENABLED,
            endpoint: env.AFTER_SALES_IMAGE_S3_ENDPOINT,
            region: env.AFTER_SALES_IMAGE_S3_REGION,
            bucket: env.AFTER_SALES_IMAGE_S3_BUCKET,
            accessKeyId: env.AFTER_SALES_IMAGE_S3_ACCESS_KEY_ID,
            secretAccessKey: env.AFTER_SALES_IMAGE_S3_SECRET_ACCESS_KEY,
            forcePathStyle: env.AFTER_SALES_IMAGE_S3_FORCE_PATH_STYLE,
            prefix: "after-sales",
          });
          return storage ? { storage } : null;
        })();
  app.use(
    "/api/v1",
    createApiV1Router(
      { ...advisor, requestLimiter: advisorLimiter },
      reviewImages,
      reviewImagesLimiter,
      reviewHelpfulLimiter,
      reviewMutationLimiter,
      afterSalesAttachments,
      afterSalesImagesLimiter,
    ),
  );
  deps.registerExtras?.(app);

  app.use(notFoundHandler);
  app.use(discardFailedUpload);
  app.use(errorHandler);
  return app;
};
