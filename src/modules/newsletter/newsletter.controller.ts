import type { RequestHandler } from "express";

import { sendCsv } from "lib/csv";
import type {
  AdminExportSubscribersQuery,
  AdminListSubscribersQuery,
  SubscribeBody,
  TokenBody,
} from "modules/newsletter/newsletter.schema";
import {
  confirmSubscription,
  exportSubscribers,
  listSubscribers,
  subscribe,
  unsubscribe,
} from "modules/newsletter/newsletter.service";

export const subscribeHandler: RequestHandler = async (req, res) => {
  res.status(202).json({ data: await subscribe((req.body as SubscribeBody).email) });
};

export const confirmHandler: RequestHandler = async (req, res) => {
  res.json({ data: await confirmSubscription((req.body as TokenBody).token) });
};

export const unsubscribeHandler: RequestHandler = async (req, res) => {
  res.json({ data: await unsubscribe((req.body as TokenBody).token) });
};

export const listSubscribersHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listSubscribers(res.locals.query as AdminListSubscribersQuery);
  res.json({ data: items, meta });
};

export const exportSubscribersHandler: RequestHandler = async (_req, res) => {
  sendCsv(
    res,
    "newsletter-subscribers",
    await exportSubscribers(res.locals.query as AdminExportSubscribersQuery),
  );
};
