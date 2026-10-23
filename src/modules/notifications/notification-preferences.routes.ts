import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  getNotificationPreferencesHandler,
  updateNotificationPreferencesHandler,
} from "modules/notifications/notification-preferences.controller";
import { updateNotificationPreferencesBody } from "modules/notifications/notification-preferences.schema";

export const notificationPreferencesRoutes = Router();

notificationPreferencesRoutes.use(authenticate);
notificationPreferencesRoutes.get("/", getNotificationPreferencesHandler);
notificationPreferencesRoutes.patch(
  "/",
  validate({ body: updateNotificationPreferencesBody }),
  updateNotificationPreferencesHandler,
);
