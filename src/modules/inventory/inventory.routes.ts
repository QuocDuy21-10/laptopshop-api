import { Router } from "express";
import { validate } from "middlewares/validate";
import {
  adjustStockHandler,
  exportMovementsHandler,
  listMovementsHandler,
} from "modules/inventory/inventory.controller";
import {
  adjustmentBody,
  exportMovementsQuery,
  listMovementsQuery,
} from "modules/inventory/inventory.schema";

export const adminInventoryRoutes = Router();

adminInventoryRoutes.post("/adjustments", validate({ body: adjustmentBody }), adjustStockHandler);
adminInventoryRoutes.get(
  "/movements",
  validate({ query: listMovementsQuery }),
  listMovementsHandler,
);
adminInventoryRoutes.get(
  "/movements/export.csv",
  validate({ query: exportMovementsQuery }),
  exportMovementsHandler,
);
