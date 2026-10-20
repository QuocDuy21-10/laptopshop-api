import { Router } from "express";
import { validate } from "middlewares/validate";
import {
  adjustStockHandler,
  exportMovementsHandler,
  listMovementsHandler,
} from "modules/inventory/inventory.controller";
import {
  createReceiptHandler,
  getReceiptHandler,
  listReceiptsHandler,
  postReceiptHandler,
  updateReceiptHandler,
} from "modules/inventory/inventory-receipts.controller";
import {
  adjustmentBody,
  exportMovementsQuery,
  listMovementsQuery,
} from "modules/inventory/inventory.schema";
import {
  createReceiptBody,
  listReceiptsQuery,
  receiptIdParams,
  updateReceiptBody,
} from "modules/inventory/inventory-receipts.schema";

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
adminInventoryRoutes.get("/receipts", validate({ query: listReceiptsQuery }), listReceiptsHandler);
adminInventoryRoutes.post("/receipts", validate({ body: createReceiptBody }), createReceiptHandler);
adminInventoryRoutes.get("/receipts/:id", validate({ params: receiptIdParams }), getReceiptHandler);
adminInventoryRoutes.patch(
  "/receipts/:id",
  validate({ params: receiptIdParams, body: updateReceiptBody }),
  updateReceiptHandler,
);
adminInventoryRoutes.post(
  "/receipts/:id/post",
  validate({ params: receiptIdParams }),
  postReceiptHandler,
);
