// import data type
/// <reference path="./types/index.d.ts" />

import express, { Express } from "express";
import cors from "cors";
import hpp from "hpp";
import pinoHttp from "pino-http";
import { Store } from "express-rate-limit";
import { env } from "config/env";
import { logger } from "lib/logger";
import { createApiV1Router } from "routes/index";
import { registerHealthRoutes } from "routes/health";
import { applySecurity } from "middlewares/security";
import { createLimiters } from "middlewares/rate-limit";
import { errorHandler, notFoundHandler } from "middlewares/error.middleware";
import { paymentWebhookRoutes } from "modules/payments/payments.routes";
import { PrismaAdvisorRepository } from "modules/advisor/advisor.repository";
import { createAdvisorService, type AdvisorService } from "modules/advisor/advisor.service";
import { createReviewImageStorage } from "lib/storage/s3-review-image-storage";
import type { ReviewImageDeps } from "modules/reviews/review-images.service";
import { AppError } from "lib/errors";
import type { ReviewImageStorage } from "lib/storage/review-image-storage";

export interface AppDeps {
  limitStores?: { global?: Store; auth?: Store; advisor?: Store; reviewImages?: Store };
  advisor?: { service: AdvisorService; identitySecret: string };
  reviewImages?: ReviewImageDeps | null;
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

  // health + uploaded images before the limiter so they do not hit Redis
  registerHealthRoutes(app, deps.readyChecks ?? []);
  app.use(express.static("public"));

  // Provider signatures are calculated over raw bytes; this route must precede express.json().
  app.use("/api/v1/webhooks/payments", paymentWebhookRoutes);

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(hpp());

  const { globalLimiter, authLimiter, advisorLimiter, reviewImagesLimiter } = createLimiters(
    deps.limitStores,
  );
  app.use(globalLimiter);
  app.post(["/api/v1/auth/login", "/api/v1/auth/register"], authLimiter);

  const advisor =
    deps.advisor ??
    ({
      service: createAdvisorService({ repository: new PrismaAdvisorRepository() }),
      identitySecret: env.JWT_SECRET,
    } as const);
  const unavailableReviewImageStorage: ReviewImageStorage = {
    putObject: async () => {
      throw new AppError(
        "Review image storage is unavailable",
        503,
        "REVIEW_IMAGE_STORAGE_UNAVAILABLE",
      );
    },
    deleteObject: async () => undefined,
    objectExists: async () => false,
    getSignedReadUrl: async () => {
      throw new AppError(
        "Review image storage is unavailable",
        503,
        "REVIEW_IMAGE_STORAGE_UNAVAILABLE",
      );
    },
  };
  const reviewImages =
    deps.reviewImages !== undefined
      ? deps.reviewImages
      : (() => {
          const storage = createReviewImageStorage(env);
          return { storage: storage ?? unavailableReviewImageStorage };
        })();
  app.use(
    "/api/v1",
    createApiV1Router(
      { ...advisor, requestLimiter: advisorLimiter },
      reviewImages,
      reviewImagesLimiter,
    ),
  );
  deps.registerExtras?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
