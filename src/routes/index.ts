import express, { type RequestHandler } from "express";
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
  createReviewHelpfulRoutes,
} from "modules/reviews/reviews.routes";
import { createReviewImageRoutes } from "modules/reviews/review-images.routes";
import type { ReviewImageDeps } from "modules/reviews/review-images.service";
import { adminPromotionRoutes, promotionRoutes } from "modules/promotions/promotions.routes";
import { wishlistRoutes } from "modules/wishlist/wishlist.routes";
import { notificationRoutes } from "modules/notifications/notifications.routes";
import { notificationPreferencesRoutes } from "modules/notifications/notification-preferences.routes";
import { webPushRoutes } from "modules/notifications/web-push.routes";

export const createApiV1Router = (
  advisor: AdvisorRouteDeps,
  reviewImages: ReviewImageDeps | null = null,
  reviewImagesLimiter?: RequestHandler,
  reviewHelpfulLimiter?: RequestHandler,
) => {
  const router = express.Router();
  router.use(originCheck(env.CORS_ORIGINS));

  router.use("/auth", authRoutes);
  router.use("/products", productReviewRoutes);
  router.use("/products", productRoutes);
  if (reviewImages)
    router.use("/reviews", createReviewImageRoutes(reviewImages, reviewImagesLimiter));
  router.use("/reviews", createReviewHelpfulRoutes(reviewHelpfulLimiter));
  router.use("/reviews", reviewRoutes);
  router.use("/users", usersRoutes);
  router.use("/cart", cartRoutes);
  router.use("/orders", orderRoutes);
  router.use("/payments", paymentRoutes);
  router.use("/advisor", createAdvisorRoutes(advisor));
  router.use("/promotions", promotionRoutes);
  router.use("/wishlist", wishlistRoutes);
  router.use("/notifications", notificationRoutes);
  router.use("/notification-preferences", notificationPreferencesRoutes);
  router.use("/web-push", webPushRoutes);

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
  admin.use("/promotions", adminPromotionRoutes);
  router.use("/admin", admin);

  router.use(notFoundHandler);
  return router;
};
