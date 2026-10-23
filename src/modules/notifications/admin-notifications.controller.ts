import type { RequestHandler } from "express";
import { IdParams } from "lib/http";
import {
  getNotificationOperations,
  listNotificationDeliveries,
  retryNotificationDelivery,
} from "modules/notifications/admin-notifications.service";
import type {
  NotificationDeliveryQuery,
  retryNotificationDeliveryBody,
} from "modules/notifications/admin-notifications.schema";

export const getNotificationOperationsHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getNotificationOperations() });
};

export const listNotificationDeliveriesHandler: RequestHandler = async (_req, res) => {
  const result = await listNotificationDeliveries(res.locals.query as NotificationDeliveryQuery);
  res.json({ data: result.items, meta: result.meta });
};

export const retryNotificationDeliveryHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  const body = req.body as { reason: string };
  res.json({ data: await retryNotificationDelivery(req.auth!.id, id, body.reason) });
};
