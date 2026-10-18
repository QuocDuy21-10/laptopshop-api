import express from "express";
import { env } from "config/env";
import { originCheck } from "middlewares/origin-check";
import { notFoundHandler } from "middlewares/error.middleware";

export const createApiV1Router = () => {
  const router = express.Router();
  router.use(originCheck(env.CORS_ORIGINS));

  router.use(notFoundHandler);
  return router;
};
