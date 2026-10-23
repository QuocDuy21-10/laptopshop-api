import { Router } from "express";
import { idParams } from "lib/http";
import { validate } from "middlewares/validate";
import {
  getNotificationOperationsHandler,
  listNotificationDeliveriesHandler,
  retryNotificationDeliveryHandler,
} from "modules/notifications/admin-notifications.controller";
import {
  notificationDeliveryQuery,
  retryNotificationDeliveryBody,
} from "modules/notifications/admin-notifications.schema";

export const adminNotificationRoutes = Router();

adminNotificationRoutes.get("/notifications/operations", getNotificationOperationsHandler);
adminNotificationRoutes.get(
  "/notification-deliveries",
  validate({ query: notificationDeliveryQuery }),
  listNotificationDeliveriesHandler,
);
adminNotificationRoutes.post(
  "/notification-deliveries/:id/retry",
  validate({ params: idParams, body: retryNotificationDeliveryBody }),
  retryNotificationDeliveryHandler,
);
