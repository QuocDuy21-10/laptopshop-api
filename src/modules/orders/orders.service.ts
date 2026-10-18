import { prisma } from "config/client";
import { AppError, notFound } from "lib/errors";
import { pageArgs, pageMeta, PageQuery } from "lib/http";
import { outOfStock } from "modules/cart/cart.service";
import {
  adminOrderInclude,
  orderInclude,
  toAdminOrderDto,
  toOrderDto,
} from "modules/orders/orders.mapper";
import { AdminListOrdersQuery, PlaceOrderBody } from "modules/orders/orders.schema";
import {
  canTransition,
  invalidTransition,
  ORDER_STATUS,
  OrderStatus,
  PAYMENT_STATUS,
} from "modules/orders/order-status";

const findByKey = (userId: number, idempotencyKey: string) =>
  prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: orderInclude,
  });

export const placeOrder = async (userId: number, key: string, receiver: PlaceOrderBody) => {
  const existing = await findByKey(userId, key);
  if (existing) return { order: toOrderDto(existing), created: false };
  try {
    const order = await prisma.$transaction(async (tx) => {
      // productId order gives every checkout the same lock order, so concurrent checkouts cannot deadlock
      const lines = await tx.cartDetail.findMany({
        where: { cart: { userId } },
        include: { product: { select: { price: true } } },
        orderBy: { productId: "asc" },
      });
      if (lines.length === 0) throw new AppError("Cart is empty", 409, "CART_EMPTY");
      for (const line of lines) {
        const { count } = await tx.product.updateMany({
          where: { id: line.productId, quantity: { gte: line.quantity } },
          data: { quantity: { decrement: line.quantity }, sold: { increment: line.quantity } },
        });
        if (count === 0) throw outOfStock(line.productId);
      }
      const created = await tx.order.create({
        data: {
          userId,
          idempotencyKey: key,
          totalPrice: lines.reduce((sum, l) => sum + l.product.price * l.quantity, 0),
          receiverName: receiver.receiverName,
          receiverAddress: receiver.receiverAddress,
          receiverPhone: receiver.receiverPhone,
          status: ORDER_STATUS.PENDING,
          paymentMethod: "COD",
          paymentStatus: PAYMENT_STATUS.UNPAID,
          orderDetails: {
            create: lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              price: l.product.price,
            })),
          },
        },
        include: orderInclude,
      });
      await tx.cartDetail.deleteMany({ where: { cart: { userId } } });
      await tx.cart.deleteMany({ where: { userId } });
      return created;
    });
    return { order: toOrderDto(order), created: true };
  } catch (e) {
    // a concurrent request with the same key may have won (P2002, OUT_OF_STOCK or CART_EMPTY here)
    const winner = await findByKey(userId, key);
    if (winner) return { order: toOrderDto(winner), created: false };
    throw e;
  }
};

export const listMyOrders = async (userId: number, q: PageQuery) => {
  const where = { userId };
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: { id: "desc" },
      ...pageArgs(q),
    }),
  ]);
  return { items: rows.map(toOrderDto), meta: pageMeta(q, total) };
};

export const getMyOrder = async (userId: number, id: number) => {
  const order = await prisma.order.findFirst({ where: { id, userId }, include: orderInclude });
  if (!order) throw notFound("Order");
  return toOrderDto(order);
};

export const changeStatus = async (
  orderId: number,
  to: OrderStatus,
  scope: { userId?: number; from?: OrderStatus[] } = {},
) =>
  prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, ...(scope.userId ? { userId: scope.userId } : {}) },
      select: { status: true },
    });
    if (!order) throw notFound("Order");
    const allowedFrom = !scope.from || scope.from.includes(order.status as OrderStatus);
    if (!allowedFrom || !canTransition(order.status, to)) throw invalidTransition(order.status, to);
    // conditional on the status we read, so two concurrent changes cannot both apply (no double restock)
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: {
        status: to,
        ...(to === ORDER_STATUS.COMPLETED ? { paymentStatus: PAYMENT_STATUS.SUCCESS } : {}),
      },
    });
    if (count === 0) throw invalidTransition(order.status, to);
    if (to === ORDER_STATUS.CANCELLED) {
      const lines = await tx.orderDetail.findMany({
        where: { orderId },
        orderBy: { productId: "asc" },
      });
      for (const l of lines) {
        await tx.product.update({
          where: { id: l.productId },
          data: { quantity: { increment: l.quantity }, sold: { decrement: l.quantity } },
        });
      }
    }
    return toOrderDto(
      await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude }),
    );
  });

export const cancelMyOrder = (userId: number, orderId: number) =>
  changeStatus(orderId, ORDER_STATUS.CANCELLED, { userId, from: [ORDER_STATUS.PENDING] });

export const listAllOrders = async (q: AdminListOrdersQuery) => {
  const where = q.status ? { status: q.status } : {};
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: adminOrderInclude,
      orderBy: { id: "desc" },
      ...pageArgs(q),
    }),
  ]);
  return { items: rows.map(toAdminOrderDto), meta: pageMeta(q, total) };
};

export const getAnyOrder = async (id: number) => {
  const order = await prisma.order.findUnique({ where: { id }, include: adminOrderInclude });
  if (!order) throw notFound("Order");
  return toAdminOrderDto(order);
};
