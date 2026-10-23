import type { RequestHandler } from "express";
import { idParams, type IdParams } from "lib/http";
import {
  disableAllWebPushSubscriptions,
  disableWebPushSubscription,
  getWebPushConfig,
  upsertWebPushSubscription,
} from "modules/notifications/web-push.service";
import type { WebPushSubscriptionBody } from "modules/notifications/web-push.schema";

export const getWebPushConfigHandler: RequestHandler = async (_req, res) => {
  res.json({ data: getWebPushConfig() });
};

export const upsertWebPushSubscriptionHandler: RequestHandler = async (req, res) => {
  res.status(201).json({
    data: await upsertWebPushSubscription(req.auth!.id, req.body as WebPushSubscriptionBody),
  });
};

export const disableWebPushSubscriptionHandler: RequestHandler = async (req, res) => {
  await disableWebPushSubscription(req.auth!.id, (res.locals.params as IdParams).id);
  res.sendStatus(204);
};

export const disableAllWebPushSubscriptionsHandler: RequestHandler = async (req, res) => {
  await disableAllWebPushSubscriptions(req.auth!.id);
  res.sendStatus(204);
};

export { idParams };
