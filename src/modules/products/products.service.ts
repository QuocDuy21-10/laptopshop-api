import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, isNotFound, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import { moveStock } from "modules/inventory/inventory.service";
import { toProductDto } from "modules/products/products.mapper";
import {
  AdminListProductsQuery,
  LOW_STOCK_THRESHOLD,
  PRICE_RANGES,
  PriceRange,
  ProductBody,
  ProductPatchBody,
} from "modules/products/products.schema";

// public callers always see only active products; admin may filter either way
export const listProducts = async (q: AdminListProductsQuery, admin = false) => {
  const where: Prisma.ProductWhereInput = {
    ...(admin ? (q.isActive === undefined ? {} : { isActive: q.isActive }) : { isActive: true }),
    ...(q.stock === "low" ? { quantity: { lte: LOW_STOCK_THRESHOLD } } : {}),
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

export const getProduct = async (id: number, admin = false) => {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || (!admin && !product.isActive)) throw notFound("Product");
  return toProductDto(product);
};

export const compareProducts = async (ids: number[]) => {
  const rows = await prisma.product.findMany({ where: { id: { in: ids }, isActive: true } });
  const byId = new Map(rows.map((p) => [p.id, p]));
  const missingIds = ids.filter((id) => !byId.has(id));
  if (missingIds.length) {
    throw new AppError("Product not found", 404, "NOT_FOUND", { missingIds });
  }
  return ids.map((id) => toProductDto(byId.get(id)!));
};

export const createProduct = async (
  input: ProductBody,
  image: string | undefined,
  actorId: number,
) =>
  prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: input.name,
        price: input.price,
        quantity: 0,
        shortDesc: input.shortDesc,
        detailDesc: input.detailDesc,
        factory: input.factory,
        target: input.target,
        cpu: input.cpu,
        gpu: input.gpu,
        ramGb: input.ramGb,
        storageGb: input.storageGb,
        screenSizeInch: input.screenSizeInch,
        screenResolution: input.screenResolution,
        refreshRateHz: input.refreshRateHz,
        batteryWh: input.batteryWh,
        weightGrams: input.weightGrams,
        warrantyMonths: input.warrantyMonths,
        ...(image ? { image } : {}),
      },
    });
    if (input.quantity === 0) return toProductDto(created);
    await moveStock(tx, {
      productId: created.id,
      delta: input.quantity,
      reason: "INITIAL",
      actorId,
    });
    return toProductDto(await tx.product.findUniqueOrThrow({ where: { id: created.id } }));
  });

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
    throw new AppError("Product is in orders; hide it instead", 409, "PRODUCT_IN_USE");
  }
  try {
    await prisma.$transaction([
      prisma.cartDetail.deleteMany({ where: { productId: id } }),
      prisma.stockMovement.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);
  } catch (e) {
    if (isNotFound(e)) throw notFound("Product");
    throw e;
  }
};
