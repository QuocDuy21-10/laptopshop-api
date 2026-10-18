import { Router } from "express";
import { idParams } from "lib/http";
import { authenticate } from "middlewares/authenticate";
import { validate } from "middlewares/validate";
import { addItemBody, updateItemBody } from "modules/cart/cart.schema";
import {
  addItemHandler,
  getCartHandler,
  removeItemHandler,
  updateItemHandler,
} from "modules/cart/cart.controller";

export const cartRoutes = Router();

cartRoutes.use(authenticate);
cartRoutes.get("/", getCartHandler);
cartRoutes.post("/items", validate({ body: addItemBody }), addItemHandler);
cartRoutes.patch(
  "/items/:id",
  validate({ params: idParams, body: updateItemBody }),
  updateItemHandler,
);
cartRoutes.delete("/items/:id", validate({ params: idParams }), removeItemHandler);
