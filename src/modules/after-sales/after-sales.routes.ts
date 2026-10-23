import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  createServiceRequestHandler,
  getMyServiceRequestHandler,
  listEligibleDevicesHandler,
  listMyServiceRequestsHandler,
} from "modules/after-sales/after-sales.controller";
import {
  createServiceRequestBody,
  deviceEligibilityQuery,
  serviceRequestParams,
  serviceRequestQuery,
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
