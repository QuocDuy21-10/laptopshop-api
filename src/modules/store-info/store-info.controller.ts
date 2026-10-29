import type { RequestHandler } from "express";
import { env } from "config/env";

// the only source of the shop's public service details: unset values are null so the UI never invents them
export const toStoreInfoDto = () => ({
  hotline: env.STORE_HOTLINE ?? null,
  supportEmail: env.STORE_SUPPORT_EMAIL ?? null,
  supportHours: env.STORE_SUPPORT_HOURS ?? null,
  vatInvoice: env.STORE_VAT_INVOICE,
});

export const getStoreInfo: RequestHandler = (_req, res) => {
  res.json({ data: toStoreInfoDto() });
};
