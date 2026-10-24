import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  createServiceRequestHandler,
  cancelMyItemHandler,
  addAdminMessageHandler,
  addInternalNoteHandler,
  addPublicMessageHandler,
  assignServiceRequestHandler,
  confirmMyItemHandler,
  disputeMyItemHandler,
  getMyServiceRequestHandler,
  listEligibleDevicesHandler,
  listMyServiceRequestsHandler,
  getAdminServiceRequestHandler,
  getAdminServiceRequestSummaryHandler,
  listAdminServiceRequestsHandler,
  listAfterSalesAssigneesHandler,
  decideQuoteHandler,
  sendQuoteHandler,
  createWarrantyVerificationHandler,
  transitionItemHandler,
} from "modules/after-sales/after-sales.controller";
import {
  createServiceRequestBody,
  completionDisputeBody,
  adminServiceRequestQuery,
  assignServiceRequestBody,
  deviceEligibilityQuery,
  serviceRequestParams,
  serviceRequestQuery,
  serviceItemParams,
  serviceMessageBody,
  transitionItemBody,
  quoteDecisionBody,
  quoteParams,
  sendQuoteBody,
  warrantyVerificationBody,
} from "modules/after-sales/after-sales.schema";

export const afterSalesRoutes = Router();

afterSalesRoutes.use(authenticate);
afterSalesRoutes.post(
  "/",
  validate({ body: createServiceRequestBody }),
  createServiceRequestHandler,
);
afterSalesRoutes.get("/", validate({ query: serviceRequestQuery }), listMyServiceRequestsHandler);
afterSalesRoutes.get(
  "/devices",
  validate({ query: deviceEligibilityQuery }),
  listEligibleDevicesHandler,
);
afterSalesRoutes.post(
  "/:id/messages",
  validate({ params: serviceRequestParams, body: serviceMessageBody }),
  addPublicMessageHandler,
);
afterSalesRoutes.get(
  "/:id",
  validate({ params: serviceRequestParams }),
  getMyServiceRequestHandler,
);
afterSalesRoutes.post(
  "/:id/items/:itemId/cancel",
  validate({ params: serviceItemParams }),
  cancelMyItemHandler,
);
afterSalesRoutes.post(
  "/:id/items/:itemId/confirm",
  validate({ params: serviceItemParams }),
  confirmMyItemHandler,
);
afterSalesRoutes.post(
  "/:id/items/:itemId/dispute-completion",
  validate({ params: serviceItemParams, body: completionDisputeBody }),
  disputeMyItemHandler,
);
afterSalesRoutes.post(
  "/:id/items/:itemId/quotes/:quoteId/decision",
  validate({ params: quoteParams, body: quoteDecisionBody }),
  decideQuoteHandler,
);

export const adminAfterSalesRoutes = Router();
adminAfterSalesRoutes.get(
  "/",
  validate({ query: adminServiceRequestQuery }),
  listAdminServiceRequestsHandler,
);
adminAfterSalesRoutes.get("/summary", getAdminServiceRequestSummaryHandler);
adminAfterSalesRoutes.get("/assignees", listAfterSalesAssigneesHandler);
adminAfterSalesRoutes.get(
  "/:id",
  validate({ params: serviceRequestParams }),
  getAdminServiceRequestHandler,
);
adminAfterSalesRoutes.patch(
  "/:id/assign",
  validate({ params: serviceRequestParams, body: assignServiceRequestBody }),
  assignServiceRequestHandler,
);
adminAfterSalesRoutes.post(
  "/:id/messages",
  validate({ params: serviceRequestParams, body: serviceMessageBody }),
  addAdminMessageHandler,
);
adminAfterSalesRoutes.post(
  "/:id/notes",
  validate({ params: serviceRequestParams, body: serviceMessageBody }),
  addInternalNoteHandler,
);
adminAfterSalesRoutes.patch(
  "/:id/items/:itemId/status",
  validate({ params: serviceItemParams, body: transitionItemBody }),
  transitionItemHandler,
);
adminAfterSalesRoutes.post(
  "/:id/items/:itemId/quotes",
  validate({ params: serviceItemParams, body: sendQuoteBody }),
  sendQuoteHandler,
);
adminAfterSalesRoutes.post(
  "/:id/items/:itemId/warranty-verifications",
  validate({ params: serviceItemParams, body: warrantyVerificationBody }),
  createWarrantyVerificationHandler,
);
