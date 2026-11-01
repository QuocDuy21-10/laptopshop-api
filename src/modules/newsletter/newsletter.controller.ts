import type { RequestHandler } from "express";

import type { SubscribeBody, TokenBody } from "modules/newsletter/newsletter.schema";
import { confirmSubscription, subscribe, unsubscribe } from "modules/newsletter/newsletter.service";

export const subscribeHandler: RequestHandler = async (req, res) => {
  res.status(202).json({ data: await subscribe((req.body as SubscribeBody).email) });
};

export const confirmHandler: RequestHandler = async (req, res) => {
  res.json({ data: await confirmSubscription((req.body as TokenBody).token) });
};

export const unsubscribeHandler: RequestHandler = async (req, res) => {
  res.json({ data: await unsubscribe((req.body as TokenBody).token) });
};
