import { RequestHandler } from "express";
import { env } from "config/env";
import { idempotencyKeyHeader } from "lib/idempotency";
import { idParams } from "lib/http";
import { getCheckoutAttempt } from "modules/payments/payments.service";
import {
  getMyPayment,
  getPaymentEvent,
  listPaymentEvents,
  listPaymentMethods,
  resolvePaymentEvent,
} from "modules/payments/payments.service";
import { ingestPaymentTransaction } from "modules/payments/payment-ingestion.service";
import { paymentProvider } from "modules/payments/payment-provider.factory";
import {
  paymentProviderParam,
  PaymentEventQuery,
  resolvePaymentEventBody,
  PaymentReviewCaseQuery,
  extendPaymentReviewCaseBody,
  releasePaymentReviewCaseBody,
} from "modules/payments/payments.schema";
import {
  extendPaymentReviewCase,
  getPaymentReviewCase,
  listPaymentReviewCases,
  releasePaymentReviewCase,
} from "modules/payments/payment-review.service";
import { AppError } from "lib/errors";

export const paymentMethodsHandler: RequestHandler = (_req, res) => {
  res.json({ data: listPaymentMethods() });
};

export const getMyPaymentHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as { id: number };
  res.json({ data: await getMyPayment(req.auth!.id, id) });
};

export const checkoutAttemptHandler: RequestHandler = async (req, res) => {
  const key = idempotencyKeyHeader.parse(req.get("idempotency-key"));
  const order = await getCheckoutAttempt(req.auth!.id, key);
  if (!order) {
    res.status(404).json({
      error: { code: "CHECKOUT_ATTEMPT_NOT_FOUND", message: "Checkout attempt not found" },
    });
    return;
  }
  res.json({ data: order });
};

export const paymentWebhookHandler: RequestHandler = async (req, res) => {
  const { provider } = paymentProviderParam.parse(req.params);
  const selected = paymentProvider();
  if (selected.id !== provider)
    throw new AppError("Payment provider is unavailable", 404, "PAYMENT_PROVIDER_NOT_FOUND");
  if (selected.id === "fake" && env.NODE_ENV === "production")
    throw new AppError("Payment provider is unavailable", 404, "PAYMENT_PROVIDER_NOT_FOUND");
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const transaction = selected.verifyWebhook({ rawBody, headers: req.headers, now: new Date() });
  await ingestPaymentTransaction(selected.authority, transaction, "WEBHOOK", rawBody);
  res.status(200).json({ success: true });
};

export const listPaymentEventsHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listPaymentEvents(res.locals.query as PaymentEventQuery);
  res.json({ data: items, meta });
};

export const getPaymentEventHandler: RequestHandler = async (_req, res) => {
  const { id } = res.locals.params as { id: string };
  res.json({ data: await getPaymentEvent(id) });
};

export const resolvePaymentEventHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as { id: string };
  const body = resolvePaymentEventBody.parse(req.body);
  res.json({ data: await resolvePaymentEvent(id, req.auth!.id, body.note) });
};

export const listPaymentReviewCasesHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listPaymentReviewCases(res.locals.query as PaymentReviewCaseQuery);
  res.json({ data: items, meta });
};

export const getPaymentReviewCaseHandler: RequestHandler = async (_req, res) => {
  const { id } = res.locals.params as { id: string };
  res.json({ data: await getPaymentReviewCase(id) });
};

export const extendPaymentReviewCaseHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as { id: string };
  const body = extendPaymentReviewCaseBody.parse(req.body) as {
    note: string;
    holdUntil: string;
    version: number;
  };
  res.json({ data: await extendPaymentReviewCase(id, req.auth!.id, body) });
};

export const releasePaymentReviewCaseHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as { id: string };
  const body = releasePaymentReviewCaseBody.parse(req.body) as {
    note: string;
    confirmation: "RELEASE_STOCK";
    version: number;
  };
  res.json({ data: await releasePaymentReviewCase(id, req.auth!.id, body) });
};

export const parseOrderId = (params: unknown) => idParams.parse(params).id;
