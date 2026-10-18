// import data type
/// <reference path="./types/index.d.ts" />

import express, { Express } from "express";
import session from "express-session";
import passport from "passport";
import cors from "cors";
import hpp from "hpp";
import pinoHttp from "pino-http";
import { Store } from "express-rate-limit";
import { env } from "config/env";
import { logger } from "lib/logger";
import webRoutes from "routes/web";
import apiRoutes from "routes/api";
import { registerHealthRoutes } from "routes/health";
import configPassportLocal from "middlewares/passport.local";
import { applySecurity } from "middlewares/security";
import { createLimiters } from "middlewares/rate-limit";
import { errorHandler, notFoundHandler } from "middlewares/error.middleware";

export interface AppDeps {
  sessionStore: session.Store;
  limitStores?: { global?: Store; auth?: Store };
  readyChecks?: Array<() => Promise<unknown>>;
  // hook for optional features that must register before the final 404/error handlers
  registerExtras?: (app: Express) => void;
}

export const createApp = (deps: AppDeps): Express => {
  const app = express();
  const isProd = env.NODE_ENV === "production";

  app.set("trust proxy", 1);
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/healthz" } }));
  applySecurity(app);
  app.use(cors({ origin: env.CORS_ORIGINS }));

  // health + static assets before session/limiter so they do not hit Redis
  registerHealthRoutes(app, deps.readyChecks ?? []);
  app.use(express.static("public"));

  app.set("view engine", "ejs");
  app.set("views", __dirname + "/views");

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(hpp());

  const { globalLimiter, authLimiter } = createLimiters(deps.limitStores);
  app.use(globalLimiter);
  app.post(["/login", "/api/login"], authLimiter);

  app.use(
    session({
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: "lax", secure: isProd },
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: deps.sessionStore,
    }),
  );

  app.use(passport.initialize());
  app.use(passport.authenticate("session"));
  configPassportLocal();

  app.use((req, res, next) => {
    res.locals.user = req.user || null; // Pass user object to all views
    next();
  });

  webRoutes(app);
  apiRoutes(app);
  deps.registerExtras?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
