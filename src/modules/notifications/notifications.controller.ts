import type { RequestHandler } from "express";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "modules/notifications/notifications.service";
import type { NotificationsQuery } from "modules/notifications/notifications.schema";
import { IdParams } from "lib/http";

export const listNotificationsHandler: RequestHandler = async (req, res) => {
  const result = await listNotifications(req.auth!.id, res.locals.query as NotificationsQuery);
  res.json({ data: result.items, meta: result.meta });
};

export const getUnreadNotificationCountHandler: RequestHandler = async (req, res) => {
  res.json({ data: await getUnreadNotificationCount(req.auth!.id) });
};

export const markNotificationReadHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  res.json({ data: await markNotificationRead(req.auth!.id, id) });
};

export const markAllNotificationsReadHandler: RequestHandler = async (req, res) => {
  res.json({ data: await markAllNotificationsRead(req.auth!.id) });
};
