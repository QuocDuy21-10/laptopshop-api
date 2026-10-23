import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  createServiceRequestHandler,
  cancelMyItemHandler,
  confirmMyItemHandler,
  disputeMyItemHandler,
  getMyServiceRequestHandler,
  listEligibleDevicesHandler,
  listMyServiceRequestsHandler,
  transitionItemHandler,
} from "modules/after-sales/after-sales.controller";
import {
  createServiceRequestBody,
  completionDisputeBody,
  deviceEligibilityQuery,
  serviceRequestParams,
  serviceRequestQuery,
  serviceItemParams,
  transitionItemBody,
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

export const adminAfterSalesRoutes = Router();
adminAfterSalesRoutes.patch(
  "/:id/items/:itemId/status",
  validate({ params: serviceItemParams, body: transitionItemBody }),
  transitionItemHandler,
);
