import type { RequestHandler } from "express";
import { env } from "config/env";
import { listPaymentMethods } from "modules/payments/payments.service";

// the only source of the shop's public service details: unset values are null so the UI never invents them
export const toStoreInfoDto = () => ({
  hotline: env.STORE_HOTLINE ?? null,
  supportEmail: env.STORE_SUPPORT_EMAIL ?? null,
  supportHours: env.STORE_SUPPORT_HOURS ?? null,
  vatInvoice: env.STORE_VAT_INVOICE,
  // only the methods the checkout can actually use right now
  paymentMethods: listPaymentMethods()
    .filter((method) => method.enabled)
    .map((method) => method.code),
});

export const getStoreInfo: RequestHandler = (_req, res) => {
  res.json({ data: toStoreInfoDto() });
};
