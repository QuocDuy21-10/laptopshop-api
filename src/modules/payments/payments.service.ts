import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "config/env";
import { prisma } from "config/client";
import { AppError, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import { classifyPaymentTransaction } from "modules/payments/payment-reconcile";
import { paymentProvider } from "modules/payments/payment-provider.factory";
import { PaymentRow, paymentInclude, toPaymentDto } from "modules/payments/payment-mapper";
import { NormalizedPaymentTransaction } from "modules/payments/providers/payment-provider";
import { PAYMENT_EVENT_STATUS, PAYMENT_STATUS } from "modules/payments/payment-status";
import { encryptPayload } from "modules/payments/payment-crypto";
import { PaymentEventQuery } from "modules/payments/payments.schema";
import { ORDER_STATUS, PAYMENT_STATUS as ORDER_PAYMENT_STATUS } from "modules/orders/order-status";
import { moveStock } from "modules/inventory/inventory.service";
import { orderInclude, toOrderDto } from "modules/orders/orders.mapper";

export const listPaymentMethods = () => [
  { code: "COD", enabled: true },
  { code: "BANK_TRANSFER", enabled: env.BANK_TRANSFER_ENABLED },
];

const instructionsFor = (payment: PaymentRow) =>
  payment.status === PAYMENT_STATUS.PENDING
    ? paymentProvider().buildInstructions({
        amount: payment.amount,
        transferCode: payment.transferCode,
      })
    : null;

export const getMyPayment = async (userId: number, orderId: number) => {
  const payment = await prisma.payment.findFirst({
    where: { order: { id: orderId, userId } },
    include: paymentInclude,
  });
  if (!payment) throw new AppError("Payment not found", 404, "PAYMENT_NOT_FOUND");
  return toPaymentDto(payment, instructionsFor(payment), new Date());
};

export const getCheckoutAttempt = async (userId: number, key: string) => {
  const order = await prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
    include: orderInclude,
  });
  return order ? toOrderDto(order) : null;
};

const eventData = (
  provider: string,
  source: string,
  transaction: NormalizedPaymentTransaction,
  status: string,
  reason: string | null,
  paymentId: string | null,
  rawPayload?: Buffer,
) => {
  const encrypted =
    rawPayload && env.PAYMENT_EVENT_ENCRYPTION_KEY
      ? encryptPayload(rawPayload, env.PAYMENT_EVENT_ENCRYPTION_KEY)
      : undefined;
  return {
    provider,
    source,
    providerEventId: transaction.providerEventId,
    providerTransactionKey: transaction.providerTransactionKey,
    paymentId,
    direction: transaction.direction,
    amount: transaction.amount,
    currency: transaction.currency,
    transferCode: transaction.transferCode,
    accountNumber: transaction.accountNumber,
    occurredAt: transaction.occurredAt,
    status,
    reviewReason: reason,
    payloadHash:
      encrypted?.hash ??
      crypto.createHash("sha256").update(JSON.stringify(transaction)).digest("hex"),
    ...(encrypted
      ? {
          rawPayload: encrypted.ciphertext,
          rawPayloadIv: encrypted.iv,
          rawPayloadTag: encrypted.tag,
          encryptionKeyId: encrypted.keyId,
        }
      : {}),
  };
};

export const ingestPaymentTransaction = async (
  transaction: NormalizedPaymentTransaction,
  source: "WEBHOOK" | "RECONCILIATION",
  rawPayload?: Buffer,
) => {
  const provider = paymentProvider();
  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await tx.paymentWebhookEvent.findFirst({
        where: {
          provider: provider.id,
          OR: [
            { providerEventId: transaction.providerEventId },
            { providerTransactionKey: transaction.providerTransactionKey },
          ],
        },
      });
      if (duplicate) return { duplicate: true, status: duplicate.status };
      const payment = transaction.transferCode
        ? await tx.payment.findUnique({
            where: { transferCode: transaction.transferCode },
            include: paymentInclude,
          })
        : null;
      const classification = payment
        ? classifyPaymentTransaction(payment, transaction)
        : { status: "REVIEW_REQUIRED" as const, reason: "UNKNOWN_CODE" as const };
      if (classification.status === "MATCHED" && payment) {
        const orderUpdated = await tx.order.updateMany({
          where: {
            id: payment.orderId,
            status: ORDER_STATUS.PENDING,
            paymentStatus: ORDER_PAYMENT_STATUS.UNPAID,
          },
          data: { paymentStatus: ORDER_PAYMENT_STATUS.SUCCESS },
        });
        if (orderUpdated.count === 0) {
          await tx.paymentWebhookEvent.create({
            data: eventData(
              provider.id,
              source,
              transaction,
              PAYMENT_EVENT_STATUS.REVIEW_REQUIRED,
              "INVALID_PAYMENT_STATE",
              payment.id,
              rawPayload,
            ),
          });
          return { duplicate: false, status: "REVIEW_REQUIRED" };
        }
        const paymentUpdated = await tx.payment.updateMany({
          where: { id: payment.id, status: PAYMENT_STATUS.PENDING },
          data: { status: PAYMENT_STATUS.SUCCEEDED, paidAt: transaction.occurredAt },
        });
        if (paymentUpdated.count === 0) {
          throw new AppError("Payment changed while confirming", 409, "PAYMENT_CONFIRMATION_RACE");
        }
        await tx.paymentWebhookEvent.create({
          data: eventData(
            provider.id,
            source,
            transaction,
            PAYMENT_EVENT_STATUS.MATCHED,
            null,
            payment.id,
            rawPayload,
          ),
        });
        return { duplicate: false, status: PAYMENT_EVENT_STATUS.MATCHED, paymentId: payment.id };
      }
      await tx.paymentWebhookEvent.create({
        data: eventData(
          provider.id,
          source,
          transaction,
          PAYMENT_EVENT_STATUS.REVIEW_REQUIRED,
          classification.reason,
          payment?.id ?? null,
          rawPayload,
        ),
      });
      return {
        duplicate: false,
        status: PAYMENT_EVENT_STATUS.REVIEW_REQUIRED,
        paymentId: payment?.id,
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { duplicate: true, status: PAYMENT_EVENT_STATUS.MATCHED };
    }
    throw error;
  }
};

export const expirePayments = async (now = new Date()) => {
  const payments = await prisma.payment.findMany({
    where: { status: PAYMENT_STATUS.PENDING, cancelAfter: { lte: now } },
    include: { order: { include: { orderDetails: true } } },
  });
  let expired = 0;
  for (const payment of payments) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: { id: payment.id, status: PAYMENT_STATUS.PENDING },
        data: { status: PAYMENT_STATUS.EXPIRED, cancelledAt: now },
      });
      if (updated.count === 0) return;
      const orderUpdated = await tx.order.updateMany({
        where: { id: payment.orderId, status: ORDER_STATUS.PENDING },
        data: { status: ORDER_STATUS.CANCELLED, paymentStatus: ORDER_PAYMENT_STATUS.FAILED },
      });
      if (orderUpdated.count === 0) return;
      for (const line of payment.order.orderDetails)
        await moveStock(tx, {
          productId: line.productId,
          delta: line.quantity,
          reason: "ORDER_CANCEL",
          orderId: payment.orderId,
          note: "Payment expired",
        });
      await tx.orderStatusHistory.create({
        data: {
          orderId: payment.orderId,
          fromStatus: ORDER_STATUS.PENDING,
          toStatus: ORDER_STATUS.CANCELLED,
          actorId: undefined,
          reason: "PAYMENT_EXPIRED",
        },
      });
      expired += 1;
    });
  }
  return expired;
};

export const listPaymentEvents = async (q: PaymentEventQuery) => {
  const where: Prisma.PaymentWebhookEventWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.reason ? { reviewReason: q.reason } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.paymentWebhookEvent.count({ where }),
    prisma.paymentWebhookEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      ...pageArgs(q),
      select: {
        id: true,
        provider: true,
        source: true,
        providerEventId: true,
        providerTransactionKey: true,
        paymentId: true,
        direction: true,
        amount: true,
        currency: true,
        transferCode: true,
        accountNumber: true,
        occurredAt: true,
        status: true,
        reviewReason: true,
        note: true,
        receivedAt: true,
        resolvedAt: true,
        resolvedById: true,
      },
    }),
  ]);
  return { items: rows, meta: pageMeta(q, total) };
};

export const getPaymentEvent = async (id: string) => {
  const event = await prisma.paymentWebhookEvent.findUnique({
    where: { id },
    select: {
      id: true,
      provider: true,
      source: true,
      providerEventId: true,
      providerTransactionKey: true,
      paymentId: true,
      direction: true,
      amount: true,
      currency: true,
      transferCode: true,
      accountNumber: true,
      occurredAt: true,
      status: true,
      reviewReason: true,
      note: true,
      receivedAt: true,
      resolvedAt: true,
      resolvedById: true,
    },
  });
  if (!event) throw notFound("Payment event");
  return event;
};

export const resolvePaymentEvent = async (id: string, actorId: number, note: string) => {
  const result = await prisma.paymentWebhookEvent.updateMany({
    where: { id, status: PAYMENT_EVENT_STATUS.REVIEW_REQUIRED },
    data: {
      status: PAYMENT_EVENT_STATUS.RESOLVED,
      note,
      resolvedAt: new Date(),
      resolvedById: actorId,
    },
  });
  if (result.count === 0)
    throw new AppError("Payment event is not reviewable", 409, "PAYMENT_EVENT_NOT_REVIEWABLE");
  return getPaymentEvent(id);
};
