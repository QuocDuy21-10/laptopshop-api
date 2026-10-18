import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import { toProductDto } from "modules/products/products.mapper";
import { ListProductsQuery, PRICE_RANGES, PriceRange } from "modules/products/products.schema";

export const listProducts = async (q: ListProductsQuery) => {
  const where: Prisma.ProductWhereInput = {
    ...(q.factory.length ? { factory: { in: q.factory } } : {}),
    ...(q.target.length ? { target: { in: q.target } } : {}),
    ...(q.price.length
      ? { OR: q.price.map((range) => ({ price: PRICE_RANGES[range as PriceRange] })) }
      : {}),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput = q.sort
    ? { price: q.sort === "price_asc" ? "asc" : "desc" }
    : { id: "asc" };
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy, ...pageArgs(q) }),
  ]);
  return { items: rows.map(toProductDto), meta: pageMeta(q, total) };
};

export const getProduct = async (id: number) => {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw notFound("Product");
  return toProductDto(product);
};
