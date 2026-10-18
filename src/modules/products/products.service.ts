import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, isNotFound, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import { toProductDto } from "modules/products/products.mapper";
import {
  ListProductsQuery,
  PRICE_RANGES,
  PriceRange,
  ProductBody,
  ProductPatchBody,
} from "modules/products/products.schema";

export const listProducts = async (q: ListProductsQuery) => {
  const where: Prisma.ProductWhereInput = {
    // MySQL utf8mb4_unicode_ci makes contains case-insensitive
    ...(q.q ? { name: { contains: q.q } } : {}),
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

export const createProduct = async (input: ProductBody, image?: string) =>
  toProductDto(
    await prisma.product.create({
      data: {
        name: input.name,
        price: input.price,
        quantity: input.quantity,
        shortDesc: input.shortDesc,
        detailDesc: input.detailDesc,
        factory: input.factory,
        target: input.target,
        ...(image ? { image } : {}),
      },
    }),
  );

export const updateProduct = async (id: number, input: ProductPatchBody, image?: string) => {
  try {
    const product = await prisma.product.update({
      where: { id },
      data: { ...input, ...(image ? { image } : {}) },
    });
    return toProductDto(product);
  } catch (e) {
    if (isNotFound(e)) throw notFound("Product");
    throw e;
  }
};

export const deleteProduct = async (id: number) => {
  const ordered = await prisma.orderDetail.count({ where: { productId: id } });
  if (ordered > 0) {
    throw new AppError("Product is in orders; set quantity to 0 instead", 409, "PRODUCT_IN_USE");
  }
  try {
    await prisma.$transaction([
      prisma.cartDetail.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);
  } catch (e) {
    if (isNotFound(e)) throw notFound("Product");
    throw e;
  }
};
