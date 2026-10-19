import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, notFound } from "lib/errors";
import { pageArgs, pageMeta, PageQuery } from "lib/http";
import { assertDayRange, createdAtRange } from "lib/shop-time";
import { productUnavailable } from "modules/cart/cart.service";
import { moveStock } from "modules/inventory/inventory.service";
import {
  adminOrderDetailInclude,
  adminOrderInclude,
  orderInclude,
  toAdminOrderDetailDto,
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
        include: { product: { select: { price: true, isActive: true } } },
        orderBy: { productId: "asc" },
      });
      if (lines.length === 0) throw new AppError("Cart is empty", 409, "CART_EMPTY");
      for (const line of lines) {
        if (!line.product.isActive) throw productUnavailable(line.productId);
      }
      // stock is taken before the order rows exist: order_detail's foreign key share-locks the product,
      // and upgrading that to the update lock in two concurrent checkouts would deadlock
      const movements = [];
      for (const line of lines) {
        movements.push(
          await moveStock(tx, {
            productId: line.productId,
            delta: -line.quantity,
            reason: "ORDER",
            actorId: userId,
            onlyActive: true,
          }),
        );
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
      await tx.orderStatusHistory.create({
        data: {
          orderId: created.id,
          fromStatus: null,
          toStatus: ORDER_STATUS.PENDING,
          actorId: userId,
        },
      });
      // link the ledger rows to the order now that it exists
      await tx.stockMovement.updateMany({
        where: { id: { in: movements.map((m) => m.id) } },
        data: { orderId: created.id },
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
  scope: { actorId: number; userId?: number; from?: OrderStatus[] },
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
        ...(to === ORDER_STATUS.COMPLETED
          ? { paymentStatus: PAYMENT_STATUS.SUCCESS, completedAt: new Date() }
          : {}),
      },
    });
    if (count === 0) throw invalidTransition(order.status, to);
    // same transaction as the status change, so history never misses or invents a transition
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: order.status, toStatus: to, actorId: scope.actorId },
    });
    if (to === ORDER_STATUS.CANCELLED) {
      const lines = await tx.orderDetail.findMany({
        where: { orderId },
        orderBy: { productId: "asc" },
      });
      for (const l of lines) {
        await moveStock(tx, {
          productId: l.productId,
          delta: l.quantity,
          reason: "ORDER_CANCEL",
          orderId,
          actorId: scope.actorId,
        });
      }
    }
    return toOrderDto(
      await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude }),
    );
  });

export const cancelMyOrder = (userId: number, orderId: number) =>
  changeStatus(orderId, ORDER_STATUS.CANCELLED, {
    actorId: userId,
    userId,
    from: [ORDER_STATUS.PENDING],
  });

export const adminOrderWhere = (q: AdminListOrdersQuery): Prisma.OrderWhereInput => {
  assertDayRange(q.from, q.to);
  // up to 9 digits always fits the INT id column; longer digit strings are phone numbers
  const id = q.q && /^\d{1,9}$/.test(q.q) ? Number(q.q) : undefined;
  const search = q.q
    ? id
      ? [{ id }, { receiverPhone: { contains: q.q } }]
      : [{ receiverName: { contains: q.q } }, { receiverPhone: { contains: q.q } }]
    : undefined;
  return {
    ...(q.status ? { status: q.status } : {}),
    ...(q.userId ? { userId: q.userId } : {}),
    ...(search ? { OR: search } : {}),
    ...createdAtRange(q.from, q.to),
  };
};

export const listAllOrders = async (q: AdminListOrdersQuery) => {
  const where = adminOrderWhere(q);
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
  const order = await prisma.order.findUnique({ where: { id }, include: adminOrderDetailInclude });
  if (!order) throw notFound("Order");
  return toAdminOrderDetailDto(order);
};
