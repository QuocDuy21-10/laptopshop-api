import { Prisma } from "@prisma/client";
import { env } from "config/env";
import { prisma } from "config/client";
import { AppError, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import { paymentProvider } from "modules/payments/payment-provider.factory";
import { PaymentRow, paymentInclude, toPaymentDto } from "modules/payments/payment-mapper";
import { PAYMENT_EVENT_STATUS, PAYMENT_STATUS } from "modules/payments/payment-status";
import { runPaymentMaintenance } from "modules/payments/payment-maintenance.service";
import { PaymentEventQuery } from "modules/payments/payments.schema";
import { orderInclude, toOrderDto } from "modules/orders/orders.mapper";

export { ingestPaymentTransaction } from "modules/payments/payment-ingestion.service";

export const listPaymentMethods = () => [
  { code: "COD", enabled: true },
  { code: "BANK_TRANSFER", enabled: env.BANK_TRANSFER_ENABLED },
];

const instructionsFor = (payment: PaymentRow) =>
  payment.status === PAYMENT_STATUS.PENDING
    ? new Date() < payment.expiresAt
      ? paymentProvider().buildInstructions({
          amount: payment.amount,
          transferCode: payment.transferCode,
          bankCode: payment.bankCode,
          accountNumber: payment.accountNumber,
          accountName: payment.accountName,
        })
      : null
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

export const expirePayments = async (now = new Date()) => {
  return (await runPaymentMaintenance(now)).expired;
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
