import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  disableAllWebPushSubscriptionsHandler,
  disableWebPushSubscriptionHandler,
  getWebPushConfigHandler,
  idParams,
  upsertWebPushSubscriptionHandler,
} from "modules/notifications/web-push.controller";
import { webPushSubscriptionBody } from "modules/notifications/web-push.schema";

export const webPushRoutes = Router();

webPushRoutes.use(authenticate);
webPushRoutes.get("/config", getWebPushConfigHandler);
webPushRoutes.post(
  "/subscriptions",
  validate({ body: webPushSubscriptionBody }),
  upsertWebPushSubscriptionHandler,
);
webPushRoutes.delete(
  "/subscriptions/:id",
  validate({ params: idParams }),
  disableWebPushSubscriptionHandler,
);
webPushRoutes.delete("/subscriptions", disableAllWebPushSubscriptionsHandler);
