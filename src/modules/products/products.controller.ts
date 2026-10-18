import { RequestHandler } from "express";
import { factoryOptions, targetOptions } from "config/constant";
import { IdParams } from "lib/http";
import { ListProductsQuery } from "modules/products/products.schema";
import { getProduct, listProducts } from "modules/products/products.service";

export const listProductsHandler: RequestHandler = async (_req, res) => {
  const { items, meta } = await listProducts(res.locals.query as ListProductsQuery);
  res.json({ data: items, meta });
};

export const getProductHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getProduct((res.locals.params as IdParams).id) });
};

export const getFiltersHandler: RequestHandler = (_req, res) => {
  res.json({ data: { factoryOptions, targetOptions } });
};
