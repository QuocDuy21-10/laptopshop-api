import { Product } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, notFound } from "lib/errors";
import { toProductDto } from "modules/products/products.mapper";
import { AddItemBody } from "modules/cart/cart.schema";

export const outOfStock = (productId: number) =>
  new AppError("Not enough stock", 409, "OUT_OF_STOCK", { productId });

export const productUnavailable = (productId: number) =>
  new AppError("Product is no longer sold", 409, "PRODUCT_UNAVAILABLE", { productId });

type Line = { id: number; quantity: number; product: Product };

const toCartDto = (lines: Line[]) => {
  const items = lines.map((l) => ({
    id: l.id,
    quantity: l.quantity,
    lineTotal: l.product.price * l.quantity,
    product: toProductDto(l.product),
  }));
  return {
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: items.reduce((n, i) => n + i.lineTotal, 0),
  };
};
export type CartDto = ReturnType<typeof toCartDto>;

export const getCart = async (userId: number) => {
  const lines = await prisma.cartDetail.findMany({
    where: { cart: { userId } },
    select: { id: true, quantity: true, product: true },
    orderBy: { id: "asc" },
  });
  return toCartDto(lines);
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
