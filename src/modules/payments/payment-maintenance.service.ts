import { env } from "config/env";
import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { paymentProvider } from "modules/payments/payment-provider.factory";
import { PAYMENT_STATUS } from "modules/payments/payment-status";
import { cancelOrder } from "modules/orders/order-cancellation.service";
import { ORDER_STATUS } from "modules/orders/order-status";

const evidenceBoundary = (cancelAfter: Date) =>
  new Date(cancelAfter.getTime() + env.PAYMENT_RECONCILIATION_SETTLEMENT_SECONDS * 1000);

export const runPaymentMaintenance = async (now = new Date()) => {
  const provider = paymentProvider();
  const payments = await prisma.payment.findMany({
    where: { status: { in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.VERIFYING] } },
    select: {
      id: true,
      orderId: true,
      provider: true,
      providerMode: true,
      status: true,
      expiresAt: true,
      cancelAfter: true,
      reviewAfter: true,
      order: { select: { status: true } },
    },
  });
  let verifying = 0;
  let expired = 0;
  let escalated = 0;

  for (const payment of payments) {
    if (payment.order.status !== "PENDING") continue;
    if (payment.status === PAYMENT_STATUS.PENDING) {
      if (payment.expiresAt > now) continue;
      const moved = await prisma.payment.updateMany({
        where: { id: payment.id, status: PAYMENT_STATUS.PENDING },
        data: { status: PAYMENT_STATUS.VERIFYING },
      });
      if (moved.count === 1) verifying += 1;
      continue;
    }

    if (payment.reviewAfter <= now) {
      const moved = await prisma.payment.updateMany({
        where: { id: payment.id, status: PAYMENT_STATUS.VERIFYING },
        data: { status: PAYMENT_STATUS.REVIEW_REQUIRED },
      });
      if (moved.count === 1) {
        await prisma.paymentReviewCase.upsert({
          where: { paymentId: payment.id },
          create: {
            paymentId: payment.id,
            reason: "RECONCILIATION_INCONCLUSIVE",
            status: "OPEN",
            nextReviewAt: payment.reviewAfter,
          },
          update: { status: "OPEN", nextReviewAt: payment.reviewAfter },
        });
        escalated += 1;
      }
      continue;
    }

    if (!payment.providerMode || payment.provider !== provider.authority.provider) continue;
    const checkpoint = await prisma.paymentProviderCheckpoint.findFirst({
      where: { provider: provider.authority.provider, mode: provider.authority.mode },
      select: {
        consecutiveSuccesses: true,
        previousVerifiedThroughAt: true,
        verifiedThroughAt: true,
      },
    });
    const boundary = evidenceBoundary(payment.cancelAfter);
    const enoughEvidence =
      checkpoint?.consecutiveSuccesses !== undefined &&
      checkpoint.consecutiveSuccesses >= 2 &&
      checkpoint.previousVerifiedThroughAt !== null &&
      checkpoint.verifiedThroughAt !== null &&
      checkpoint.previousVerifiedThroughAt >= boundary &&
      checkpoint.verifiedThroughAt >= boundary;
    if (!enoughEvidence) continue;

    try {
      await prisma.$transaction(async (tx) => {
        await cancelOrder(tx, {
          orderId: payment.orderId,
          from: [ORDER_STATUS.PENDING],
          paymentDisposition: "EXPIRE",
          reason: "PAYMENT_EXPIRED",
          now,
        });
      });
      expired += 1;
    } catch (error) {
      if (error instanceof AppError && error.code === "INVALID_STATUS_TRANSITION") continue;
      throw error;
    }
  }

  return { verifying, expired, escalated };
};
