import express from "express";
import { env } from "config/env";
import { originCheck } from "middlewares/origin-check";
import { authRoutes } from "modules/auth/auth.routes";
import { productRoutes } from "modules/products/products.routes";
import { usersRoutes } from "modules/users/users.routes";
import { notFoundHandler } from "middlewares/error.middleware";

export const createApiV1Router = () => {
  const router = express.Router();
  router.use(originCheck(env.CORS_ORIGINS));

  router.use("/auth", authRoutes);
  router.use("/products", productRoutes);
  router.use("/users", usersRoutes);

  router.use(notFoundHandler);
  return router;
};
