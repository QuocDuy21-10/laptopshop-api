import { Router } from "express";

import { validate } from "middlewares/validate";
import { subscribeBody, tokenBody } from "modules/newsletter/newsletter.schema";
import {
  confirmHandler,
  subscribeHandler,
  unsubscribeHandler,
} from "modules/newsletter/newsletter.controller";

export const newsletterRoutes = Router();
newsletterRoutes.post("/subscribe", validate({ body: subscribeBody }), subscribeHandler);
newsletterRoutes.post("/confirm", validate({ body: tokenBody }), confirmHandler);
newsletterRoutes.post("/unsubscribe", validate({ body: tokenBody }), unsubscribeHandler);
