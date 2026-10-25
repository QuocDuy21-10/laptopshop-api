import { Product } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, notFound } from "lib/errors";
import { AddItemBody } from "modules/cart/cart.schema";
import { toPricedProductDto } from "modules/products/products.mapper";
import {
  resolveProductPromotions,
  type ProductPromotionResolution,
} from "modules/promotions/promotion-resolver";
import { toPublicPromotionFallback } from "modules/promotions/promotion-selection";

export const outOfStock = (productId: number) =>
  new AppError("Not enough stock", 409, "OUT_OF_STOCK", { productId });

export const productUnavailable = (productId: number) =>
  new AppError("Product is no longer sold", 409, "PRODUCT_UNAVAILABLE", { productId });

type Line = { id: number; quantity: number; product: Product };

const toCartDto = (lines: Line[], promotions: Map<number, ProductPromotionResolution>) => {
  const items = lines.map((l) => {
    const resolution = promotions.get(l.product.id) ?? null;
    const unitDiscount = resolution?.winner?.unitDiscount ?? 0;
    return {
      id: l.id,
      quantity: l.quantity,
      listLineTotal: l.product.price * l.quantity,
      productDiscountAmount: unitDiscount * l.quantity,
      lineTotal: (l.product.price - unitDiscount) * l.quantity,
      product: toPricedProductDto(l.product, resolution),
      promotionFallback: toPublicPromotionFallback(resolution?.fallback ?? null),
    };
  });
  const subtotal = items.reduce((n, i) => n + i.listLineTotal, 0);
  const productDiscount = items.reduce((n, i) => n + i.productDiscountAmount, 0);
  return {
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotal,
    productDiscount,
    totalAfterProductDiscount: subtotal - productDiscount,
  };
};
export type CartDto = ReturnType<typeof toCartDto>;

export const getCart = async (userId: number) => {
  const lines = await prisma.cartDetail.findMany({
    where: { cart: { userId } },
    select: { id: true, quantity: true, product: true },
    orderBy: { id: "asc" },
  });
  const promotions = await resolveProductPromotions(
    prisma,
    lines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
    { now: new Date(), userId, eligibilityMode: "EXACT" },
  );
  return toCartDto(lines, promotions);
};

export const addItem = async (userId: number, { productId, quantity }: AddItemBody) => {
  await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { quantity: true, isActive: true },
    });
    if (!product) throw notFound("Product");
    if (!product.isActive) throw productUnavailable(productId);
    const cart = await tx.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    const line = await tx.cartDetail.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      create: { cartId: cart.id, productId, quantity },
      update: { quantity: { increment: quantity } },
      select: { quantity: true },
    });
    if (line.quantity > product.quantity) throw outOfStock(productId);
  });
  return getCart(userId);
};

export const updateItem = async (userId: number, lineId: number, quantity: number) => {
  const line = await prisma.cartDetail.findFirst({
    where: { id: lineId, cart: { userId } },
    select: { productId: true, product: { select: { quantity: true, isActive: true } } },
  });
  if (!line) throw notFound("Cart item");
  if (!line.product.isActive) throw productUnavailable(line.productId);
  if (quantity > line.product.quantity) throw outOfStock(line.productId);
  await prisma.cartDetail.update({ where: { id: lineId }, data: { quantity } });
  return getCart(userId);
};

export const removeItem = async (userId: number, lineId: number) => {
  const { count } = await prisma.cartDetail.deleteMany({
    where: { id: lineId, cart: { userId } },
  });
  if (count === 0) throw notFound("Cart item");
};
