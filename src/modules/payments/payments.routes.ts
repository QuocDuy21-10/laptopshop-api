import express, { Router } from "express";
import { idParams } from "lib/http";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  paymentMethodsHandler,
  getMyPaymentHandler,
  checkoutAttemptHandler,
  paymentWebhookHandler,
  listPaymentEventsHandler,
  getPaymentEventHandler,
  resolvePaymentEventHandler,
} from "modules/payments/payments.controller";
import { paymentEventQuery, paymentProviderParam } from "modules/payments/payments.schema";

export const paymentRoutes = Router();
paymentRoutes.use(authenticate);
paymentRoutes.get("/methods", paymentMethodsHandler);

export const paymentWebhookRoutes = Router();
paymentWebhookRoutes.post(
  "/:provider",
  express.raw({ type: "application/json", limit: "100kb" }),
  validate({ params: paymentProviderParam }),
  paymentWebhookHandler,
);

export const adminPaymentRoutes = Router();
adminPaymentRoutes.get("/", validate({ query: paymentEventQuery }), listPaymentEventsHandler);
adminPaymentRoutes.get("/:id", getPaymentEventHandler);
adminPaymentRoutes.post("/:id/resolve", resolvePaymentEventHandler);

export const orderPaymentRoutes = Router();
orderPaymentRoutes.use(authenticate);
orderPaymentRoutes.get("/me/:id/payment", validate({ params: idParams }), getMyPaymentHandler);
orderPaymentRoutes.get("/checkout-attempt", checkoutAttemptHandler);
