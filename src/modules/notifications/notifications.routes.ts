import { Router } from "express";
import { idParams } from "lib/http";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  getUnreadNotificationCountHandler,
  listNotificationsHandler,
  markAllNotificationsReadHandler,
  markNotificationReadHandler,
} from "modules/notifications/notifications.controller";
import { notificationsQuery } from "modules/notifications/notifications.schema";

export const notificationRoutes = Router();

notificationRoutes.use(authenticate);
notificationRoutes.get("/", validate({ query: notificationsQuery }), listNotificationsHandler);
notificationRoutes.get("/unread-count", getUnreadNotificationCountHandler);
notificationRoutes.patch("/read-all", markAllNotificationsReadHandler);
notificationRoutes.patch("/:id/read", validate({ params: idParams }), markNotificationReadHandler);
