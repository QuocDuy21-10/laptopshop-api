import { Router } from "express";

import { validate } from "middlewares/validate";
import {
  adminExportSubscribersQuery,
  adminListSubscribersQuery,
  subscribeBody,
  tokenBody,
} from "modules/newsletter/newsletter.schema";
import {
  confirmHandler,
  exportSubscribersHandler,
  listSubscribersHandler,
  subscribeHandler,
  unsubscribeHandler,
} from "modules/newsletter/newsletter.controller";

export const newsletterRoutes = Router();
newsletterRoutes.post("/subscribe", validate({ body: subscribeBody }), subscribeHandler);
newsletterRoutes.post("/confirm", validate({ body: tokenBody }), confirmHandler);
newsletterRoutes.post("/unsubscribe", validate({ body: tokenBody }), unsubscribeHandler);

export const adminNewsletterRoutes = Router();
adminNewsletterRoutes.get(
  "/subscribers",
  validate({ query: adminListSubscribersQuery }),
  listSubscribersHandler,
);
adminNewsletterRoutes.get(
  "/subscribers/export.csv",
  validate({ query: adminExportSubscribersQuery }),
  exportSubscribersHandler,
);
