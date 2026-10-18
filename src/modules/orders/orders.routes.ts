import { Router } from "express";
import { idParams, pageQuery } from "lib/http";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import { placeOrderBody } from "modules/orders/orders.schema";
import {
  cancelMyOrderHandler,
  getMyOrderHandler,
  listMyOrdersHandler,
  placeOrderHandler,
} from "modules/orders/orders.controller";

export const orderRoutes = Router();

orderRoutes.use(authenticate);
orderRoutes.post("/", validate({ body: placeOrderBody }), placeOrderHandler);
orderRoutes.get("/me", validate({ query: pageQuery }), listMyOrdersHandler);
orderRoutes.get("/me/:id", validate({ params: idParams }), getMyOrderHandler);
orderRoutes.post("/me/:id/cancel", validate({ params: idParams }), cancelMyOrderHandler);
