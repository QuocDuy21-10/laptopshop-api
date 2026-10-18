import { Router } from "express";
import { idParams } from "lib/http";
import { validate } from "middlewares/validate";
import { listProductsQuery } from "modules/products/products.schema";
import {
  getFiltersHandler,
  getProductHandler,
  listProductsHandler,
} from "modules/products/products.controller";

export const productRoutes = Router();

productRoutes.get("/", validate({ query: listProductsQuery }), listProductsHandler);
productRoutes.get("/filters", getFiltersHandler);
productRoutes.get("/:id", validate({ params: idParams }), getProductHandler);
