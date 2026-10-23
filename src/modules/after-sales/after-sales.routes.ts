import { Router } from "express";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import { listEligibleDevicesHandler } from "modules/after-sales/after-sales.controller";
import { deviceEligibilityQuery } from "modules/after-sales/after-sales.schema";

export const afterSalesRoutes = Router();

afterSalesRoutes.use(authenticate);
afterSalesRoutes.get(
  "/devices",
  validate({ query: deviceEligibilityQuery }),
  listEligibleDevicesHandler,
);
