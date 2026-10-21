import express from "express";
import { env } from "config/env";
import { originCheck } from "middlewares/origin-check";
import { authenticate } from "middlewares/authenticate";
import { requireRole } from "middlewares/require-role";
import { authRoutes } from "modules/auth/auth.routes";
import { adminProductRoutes, productRoutes } from "modules/products/products.routes";
import { adminRoleRoutes, adminUserRoutes, usersRoutes } from "modules/users/users.routes";
import { cartRoutes } from "modules/cart/cart.routes";
import { adminOrderRoutes, orderRoutes } from "modules/orders/orders.routes";
import { adminInventoryRoutes } from "modules/inventory/inventory.routes";
import { dashboardRoutes } from "modules/dashboard/dashboard.routes";
import { notFoundHandler } from "middlewares/error.middleware";
import { adminPaymentRoutes, paymentRoutes } from "modules/payments/payments.routes";
import { createAdvisorRoutes, type AdvisorRouteDeps } from "modules/advisor/advisor.routes";
import {
  productReviewRoutes,
  reviewRoutes,
  adminReviewRoutes,
} from "modules/reviews/reviews.routes";

export const createApiV1Router = (advisor: AdvisorRouteDeps) => {
  const router = express.Router();
  router.use(originCheck(env.CORS_ORIGINS));

  router.use("/auth", authRoutes);
  router.use("/products", productReviewRoutes);
  router.use("/products", productRoutes);
  router.use("/reviews", reviewRoutes);
  router.use("/users", usersRoutes);
  router.use("/cart", cartRoutes);
  router.use("/orders", orderRoutes);
  router.use("/payments", paymentRoutes);
  router.use("/advisor", createAdvisorRoutes(advisor));

  const admin = express.Router();
  admin.use(authenticate, requireRole("ADMIN"));
  admin.use("/products", adminProductRoutes);
  admin.use("/users", adminUserRoutes);
  admin.use("/roles", adminRoleRoutes);
  admin.use("/orders", adminOrderRoutes);
  admin.use("/dashboard", dashboardRoutes);
  admin.use("/inventory", adminInventoryRoutes);
  admin.use("/payment-events", adminPaymentRoutes);
  admin.use("/reviews", adminReviewRoutes);
  router.use("/admin", admin);

  router.use(notFoundHandler);
  return router;
};
