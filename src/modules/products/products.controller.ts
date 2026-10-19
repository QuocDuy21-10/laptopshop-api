import { RequestHandler } from "express";
import { factoryOptions, targetOptions } from "config/constant";
import { sendCsv } from "lib/csv";
import { IdParams } from "lib/http";
import {
  AdminExportProductsQuery,
  AdminListProductsQuery,
  ListProductsQuery,
  ProductBody,
  ProductPatchBody,
} from "modules/products/products.schema";
import {
  createProduct,
  deleteProduct,
  exportProducts,
  getProduct,
  listProducts,
  updateProduct,
} from "modules/products/products.service";

export const listProductsHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listProducts(res.locals.query as ListProductsQuery);
  res.json({ data: items, meta });
};

export const getProductHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getProduct((res.locals.params as IdParams).id) });
};

export const listAdminProductsHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listProducts(res.locals.query as AdminListProductsQuery, true);
  res.json({ data: items, meta });
};

export const getAdminProductHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getProduct((res.locals.params as IdParams).id, true) });
};

export const getFiltersHandler: RequestHandler = (_req, res) => {
  res.json({ data: { factoryOptions, targetOptions } });
};

export const createProductHandler: RequestHandler = async (req, res) => {
  const product = await createProduct(req.body as ProductBody, req.file?.filename, req.auth!.id);
  res.status(201).json({ data: product });
};

export const updateProductHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  res.json({ data: await updateProduct(id, req.body as ProductPatchBody, req.file?.filename) });
};

export const deleteProductHandler: RequestHandler = async (_req, res) => {
  await deleteProduct((res.locals.params as IdParams).id);
  res.sendStatus(204);
};

export const exportProductsHandler: RequestHandler = async (_req, res) => {
  sendCsv(res, "products", await exportProducts(res.locals.query as AdminExportProductsQuery));
};
