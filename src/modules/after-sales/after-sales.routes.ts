import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  createServiceRequestHandler,
  listEligibleDevicesHandler,
} from "modules/after-sales/after-sales.controller";
import {
  createServiceRequestBody,
  deviceEligibilityQuery,
} from "modules/after-sales/after-sales.schema";

export const afterSalesRoutes = Router();

afterSalesRoutes.use(authenticate);
afterSalesRoutes.post(
  "/",
  validate({ body: createServiceRequestBody }),
  createServiceRequestHandler,
);
afterSalesRoutes.get(
  "/devices",
  validate({ query: deviceEligibilityQuery }),
  listEligibleDevicesHandler,
);
