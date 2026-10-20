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

export interface AppDeps {
  limitStores?: { global?: Store; auth?: Store };
  advisor?: { service: AdvisorService; identitySecret: string };
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

  const { globalLimiter, authLimiter } = createLimiters(deps.limitStores);
  app.use(globalLimiter);
  app.post(["/api/v1/auth/login", "/api/v1/auth/register"], authLimiter);

  const advisor =
    deps.advisor ??
    ({
      service: createAdvisorService({ repository: new PrismaAdvisorRepository() }),
      identitySecret: env.JWT_SECRET,
    } as const);
  app.use("/api/v1", createApiV1Router(advisor));
  deps.registerExtras?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
