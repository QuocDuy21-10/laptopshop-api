import { Router } from "express";
import { validate } from "middlewares/validate";
import { adjustStockHandler, listMovementsHandler } from "modules/inventory/inventory.controller";
import { adjustmentBody, listMovementsQuery } from "modules/inventory/inventory.schema";

export const adminInventoryRoutes = Router();

adminInventoryRoutes.post("/adjustments", validate({ body: adjustmentBody }), adjustStockHandler);
adminInventoryRoutes.get(
  "/movements",
  validate({ query: listMovementsQuery }),
  listMovementsHandler,
);
