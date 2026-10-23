import type { RequestHandler } from "express";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "modules/notifications/notification-preferences.service";
import type { UpdateNotificationPreferencesBody } from "modules/notifications/notification-preferences.schema";

export const getNotificationPreferencesHandler: RequestHandler = async (req, res) => {
  res.json({ data: await getNotificationPreferences(req.auth!.id) });
};

export const updateNotificationPreferencesHandler: RequestHandler = async (req, res) => {
  res.json({
    data: await updateNotificationPreferences(
      req.auth!.id,
      req.body as UpdateNotificationPreferencesBody,
    ),
  });
};
