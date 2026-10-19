import { Router } from "express";
import { idParams, pageQuery } from "lib/http";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import {
  adminExportOrdersQuery,
  adminListOrdersQuery,
  placeOrderBody,
  updateStatusBody,
} from "modules/orders/orders.schema";
import {
  cancelMyOrderHandler,
  exportOrdersHandler,
  getAnyOrderHandler,
  getMyOrderHandler,
  listAllOrdersHandler,
  listMyOrdersHandler,
  placeOrderHandler,
  updateStatusHandler,
} from "modules/orders/orders.controller";
import { checkoutAttemptHandler, getMyPaymentHandler } from "modules/payments/payments.controller";

export const orderRoutes = Router();

orderRoutes.use(authenticate);
orderRoutes.post("/", validate({ body: placeOrderBody }), placeOrderHandler);
orderRoutes.get("/checkout-attempt", checkoutAttemptHandler);
orderRoutes.get("/me", validate({ query: pageQuery }), listMyOrdersHandler);
orderRoutes.get("/me/:id/payment", validate({ params: idParams }), getMyPaymentHandler);
orderRoutes.get("/me/:id", validate({ params: idParams }), getMyOrderHandler);
orderRoutes.post("/me/:id/cancel", validate({ params: idParams }), cancelMyOrderHandler);

export const adminOrderRoutes = Router();

adminOrderRoutes.get("/", validate({ query: adminListOrdersQuery }), listAllOrdersHandler);
adminOrderRoutes.get(
  "/export.csv",
  validate({ query: adminExportOrdersQuery }),
  exportOrdersHandler,
);
adminOrderRoutes.get("/:id", validate({ params: idParams }), getAnyOrderHandler);
adminOrderRoutes.patch(
  "/:id/status",
  validate({ params: idParams, body: updateStatusBody }),
  updateStatusHandler,
);
