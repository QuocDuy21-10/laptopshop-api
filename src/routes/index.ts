import express from "express";
import { env } from "config/env";
import { originCheck } from "middlewares/origin-check";
import { authRoutes } from "modules/auth/auth.routes";
import { productRoutes } from "modules/products/products.routes";
import { usersRoutes } from "modules/users/users.routes";
import { cartRoutes } from "modules/cart/cart.routes";
import { orderRoutes } from "modules/orders/orders.routes";
import { notFoundHandler } from "middlewares/error.middleware";

export const createApiV1Router = () => {
  const router = express.Router();
  router.use(originCheck(env.CORS_ORIGINS));

  router.use("/auth", authRoutes);
  router.use("/products", productRoutes);
  router.use("/users", usersRoutes);
  router.use("/cart", cartRoutes);
  router.use("/orders", orderRoutes);

  router.use(notFoundHandler);
  return router;
};
