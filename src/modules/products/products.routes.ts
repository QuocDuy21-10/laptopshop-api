import { Router } from "express";
import { idParams } from "lib/http";
import fileUploadMiddleware from "middlewares/multer";
import { validate } from "middlewares/validate";
import {
  adminListProductsQuery,
  compareQuery,
  listProductsQuery,
  productBody,
  productPatchBody,
} from "modules/products/products.schema";
import {
  compareProductsHandler,
  createProductHandler,
  deleteProductHandler,
  getAdminProductHandler,
  getFiltersHandler,
  getProductHandler,
  listAdminProductsHandler,
  listProductsHandler,
  updateProductHandler,
} from "modules/products/products.controller";

export const productRoutes = Router();

productRoutes.get("/", validate({ query: listProductsQuery }), listProductsHandler);
productRoutes.get("/filters", getFiltersHandler);
// must stay above "/:id", which would otherwise capture "compare"
productRoutes.get("/compare", validate({ query: compareQuery }), compareProductsHandler);
productRoutes.get("/:id", validate({ params: idParams }), getProductHandler);

const productImageUpload = fileUploadMiddleware("image", "images/product");

export const adminProductRoutes = Router();

adminProductRoutes.get("/", validate({ query: adminListProductsQuery }), listAdminProductsHandler);
adminProductRoutes.post(
  "/",
  productImageUpload,
  validate({ body: productBody }),
  createProductHandler,
);
adminProductRoutes.get("/:id", validate({ params: idParams }), getAdminProductHandler);
adminProductRoutes.patch(
  "/:id",
  productImageUpload,
  validate({ params: idParams, body: productPatchBody }),
  updateProductHandler,
);
adminProductRoutes.delete("/:id", validate({ params: idParams }), deleteProductHandler);
