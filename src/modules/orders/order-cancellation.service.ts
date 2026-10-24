import { Prisma } from "@prisma/client";
import { AppError, notFound } from "lib/errors";
import { moveStock } from "modules/inventory/inventory.service";
import { reverseCouponRedemption } from "modules/promotions/promotion-usage";
import { releaseFlashSaleAllocations } from "modules/promotions/flash-sale-quota";
import { orderInclude, toOrderDto, type OrderDto } from "modules/orders/orders.mapper";
import {
  canTransition,
  invalidTransition,
  ORDER_STATUS,
  PAYMENT_STATUS,
  type OrderStatus,
} from "modules/orders/order-status";

export const cancelOrder = async (
  tx: Prisma.TransactionClient,
  input: {
    orderId: number;
    actorId?: number;
    userId?: number;
    from: OrderStatus[];
    reason?: string;
    paymentDisposition: "CANCEL" | "EXPIRE";
    allowVerificationCancel?: boolean;
    now: Date;
  },
): Promise<OrderDto> => {
  const order = await tx.order.findFirst({
    where: { id: input.orderId, ...(input.userId ? { userId: input.userId } : {}) },
    select: {
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      payment: { select: { status: true } },
    },
  });
  if (!order) throw notFound("Order");
  if (
    !input.from.includes(order.status as OrderStatus) ||
    !canTransition(order.status, ORDER_STATUS.CANCELLED)
  ) {
    throw invalidTransition(order.status, ORDER_STATUS.CANCELLED);
  }
  if (order.paymentMethod === "BANK_TRANSFER" && order.paymentStatus === PAYMENT_STATUS.SUCCESS) {
    throw new AppError("A paid order requires refund handling", 409, "PAID_ORDER_CANNOT_CANCEL");
  }
  if (
    input.paymentDisposition === "CANCEL" &&
    !input.allowVerificationCancel &&
    order.paymentMethod === "BANK_TRANSFER" &&
    (order.payment?.status === "VERIFYING" || order.payment?.status === "REVIEW_REQUIRED")
  ) {
    throw new AppError(
      "Payment verification is still in progress",
      409,
      "PAYMENT_VERIFICATION_IN_PROGRESS",
    );
  }
  const allowedPaymentStatuses =
    input.paymentDisposition === "EXPIRE" || input.allowVerificationCancel
      ? ["PENDING", "VERIFYING", "REVIEW_REQUIRED"]
      : ["PENDING"];
  const updated = await tx.order.updateMany({
    where: {
      id: input.orderId,
      status: order.status,
      ...(order.paymentMethod === "BANK_TRANSFER"
        ? {
            paymentStatus: PAYMENT_STATUS.UNPAID,
            payment: { status: { in: allowedPaymentStatuses } },
          }
        : {}),
    },
    data: {
      status: ORDER_STATUS.CANCELLED,
      ...(order.paymentMethod === "BANK_TRANSFER" ? { paymentStatus: PAYMENT_STATUS.FAILED } : {}),
    },
  });
  if (updated.count !== 1) throw invalidTransition(order.status, ORDER_STATUS.CANCELLED);
  if (order.paymentMethod === "BANK_TRANSFER") {
    await tx.payment.updateMany({
      where: {
        orderId: input.orderId,
        status:
          input.paymentDisposition === "EXPIRE" || input.allowVerificationCancel
            ? { in: ["PENDING", "VERIFYING", "REVIEW_REQUIRED"] }
            : "PENDING",
      },
      data: {
        status: input.paymentDisposition === "EXPIRE" ? "EXPIRED" : "CANCELLED",
        cancelledAt: input.now,
      },
    });
  }
  const lines = await tx.orderDetail.findMany({
    where: { orderId: input.orderId },
    orderBy: { productId: "asc" },
  });
  for (const line of lines) {
    await moveStock(tx, {
      productId: line.productId,
      delta: line.quantity,
      reason: "ORDER_CANCEL",
      orderId: input.orderId,
      actorId: input.actorId,
      note: input.reason,
    });
  }
  await reverseCouponRedemption(tx, {
    orderId: input.orderId,
    reason: input.reason ?? "CANCELLED",
    now: input.now,
  });
  await releaseFlashSaleAllocations(tx, {
    orderId: input.orderId,
    reason: input.reason ?? input.paymentDisposition,
    now: input.now,
  });
  await tx.orderStatusHistory.create({
    data: {
      orderId: input.orderId,
      fromStatus: order.status,
      toStatus: ORDER_STATUS.CANCELLED,
      actorId: input.actorId,
      reason: input.reason,
    },
  });
  return toOrderDto(
    await tx.order.findUniqueOrThrow({ where: { id: input.orderId }, include: orderInclude }),
  );
};
