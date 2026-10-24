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
  listPaymentReviewCasesHandler,
  getPaymentReviewCaseHandler,
  extendPaymentReviewCaseHandler,
  releasePaymentReviewCaseHandler,
} from "modules/payments/payments.controller";
import {
  paymentEventIdParams,
  paymentEventQuery,
  paymentProviderParam,
  paymentReviewCaseIdParams,
  paymentReviewCaseQuery,
  extendPaymentReviewCaseBody,
  releasePaymentReviewCaseBody,
} from "modules/payments/payments.schema";

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
adminPaymentRoutes.get("/:id", validate({ params: paymentEventIdParams }), getPaymentEventHandler);
adminPaymentRoutes.post(
  "/:id/resolve",
  validate({ params: paymentEventIdParams }),
  resolvePaymentEventHandler,
);

export const adminPaymentReviewRoutes = Router();
adminPaymentReviewRoutes.get(
  "/",
  validate({ query: paymentReviewCaseQuery }),
  listPaymentReviewCasesHandler,
);
adminPaymentReviewRoutes.get(
  "/:id",
  validate({ params: paymentReviewCaseIdParams }),
  getPaymentReviewCaseHandler,
);
adminPaymentReviewRoutes.post(
  "/:id/extend",
  validate({ params: paymentReviewCaseIdParams, body: extendPaymentReviewCaseBody }),
  extendPaymentReviewCaseHandler,
);
adminPaymentReviewRoutes.post(
  "/:id/release",
  validate({ params: paymentReviewCaseIdParams, body: releasePaymentReviewCaseBody }),
  releasePaymentReviewCaseHandler,
);

export const orderPaymentRoutes = Router();
orderPaymentRoutes.use(authenticate);
orderPaymentRoutes.get("/me/:id/payment", validate({ params: idParams }), getMyPaymentHandler);
orderPaymentRoutes.get("/checkout-attempt", checkoutAttemptHandler);
