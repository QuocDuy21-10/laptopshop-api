import express from "express";
import { env } from "config/env";
import { originCheck } from "middlewares/origin-check";
import { authenticate } from "middlewares/authenticate";
import { requireRole } from "middlewares/require-role";
import { authRoutes } from "modules/auth/auth.routes";
import { adminProductRoutes, productRoutes } from "modules/products/products.routes";
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

  const admin = express.Router();
  admin.use(authenticate, requireRole("ADMIN"));
  admin.use("/products", adminProductRoutes);
  router.use("/admin", admin);

  router.use(notFoundHandler);
  return router;
};
