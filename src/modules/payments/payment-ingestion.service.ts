import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "config/env";
import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { samePaymentAuthority, PaymentAuthority } from "modules/payments/payment-authority";
import { classifyPaymentTransaction } from "modules/payments/payment-reconcile";
import { PaymentRow, paymentInclude } from "modules/payments/payment-mapper";
import {
  PAYMENT_EVENT_STATUS,
  PAYMENT_REVIEW_REASON,
  PAYMENT_STATUS,
} from "modules/payments/payment-status";
import { encryptPayload } from "modules/payments/payment-crypto";
import { NormalizedPaymentTransaction } from "modules/payments/providers/payment-provider";
import { ORDER_STATUS, PAYMENT_STATUS as ORDER_PAYMENT_STATUS } from "modules/orders/order-status";

type PaymentDb = Prisma.TransactionClient | PrismaClient;
export type PaymentTransactionSource = "WEBHOOK" | "RECONCILIATION";
export type IngestPaymentResult = {
  duplicate: boolean;
  status: "MATCHED" | "REVIEW_REQUIRED" | "RESOLVED";
  paymentId?: string;
};

const eventData = (
  authority: PaymentAuthority,
  source: PaymentTransactionSource,
  transaction: NormalizedPaymentTransaction,
  status: string,
  reason: string | null,
  paymentId: string | null,
  rawPayload?: Buffer,
) => {
  const encrypted =
    rawPayload && env.PAYMENT_EVENT_ENCRYPTION_KEY
      ? encryptPayload(
          rawPayload,
          env.PAYMENT_EVENT_ENCRYPTION_KEY,
          env.PAYMENT_EVENT_KEY_ID ?? "payment-key-v1",
        )
      : undefined;
  return {
    provider: authority.provider,
    providerMode: authority.mode,
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

const duplicateEvent = async (
  db: PaymentDb,
  authority: PaymentAuthority,
  transaction: NormalizedPaymentTransaction,
) => {
  const rows = await db.paymentWebhookEvent.findMany({
    where: {
      provider: authority.provider,
      providerMode: authority.mode,
      OR: [
        { providerEventId: transaction.providerEventId },
        { providerTransactionKey: transaction.providerTransactionKey },
      ],
    },
    take: 3,
  });
  const distinctRows = new Map(rows.map((row) => [row.id, row]));
  if (distinctRows.size > 1)
    throw new AppError("Payment event identity conflict", 409, "PAYMENT_EVENT_IDENTITY_CONFLICT");
  return rows[0] ?? null;
};

const isPaymentAuthorityMatch = (payment: PaymentRow, authority: PaymentAuthority) =>
  payment.providerMode !== null &&
  samePaymentAuthority(
    {
      provider: payment.provider as PaymentAuthority["provider"],
      mode: payment.providerMode as PaymentAuthority["mode"],
    },
    authority,
  );

export const ingestPaymentTransaction = async (
  authority: PaymentAuthority,
  transaction: NormalizedPaymentTransaction,
  source: PaymentTransactionSource,
  rawPayload?: Buffer,
): Promise<IngestPaymentResult> => {
  try {
    return await prisma.$transaction(async (tx) => {
      const duplicate = await duplicateEvent(tx, authority, transaction);
      if (duplicate)
        return {
          duplicate: true,
          status: duplicate.status as IngestPaymentResult["status"],
          paymentId: duplicate.paymentId ?? undefined,
        };

      const payment = transaction.transferCode
        ? await tx.payment.findUnique({
            where: { transferCode: transaction.transferCode },
            include: paymentInclude,
          })
        : null;

      if (payment && !isPaymentAuthorityMatch(payment, authority)) {
        await tx.paymentWebhookEvent.create({
          data: eventData(
            authority,
            source,
            transaction,
            PAYMENT_EVENT_STATUS.REVIEW_REQUIRED,
            "PROVIDER_MISMATCH",
            payment.id,
            rawPayload,
          ),
        });
        return {
          duplicate: false,
          status: PAYMENT_EVENT_STATUS.REVIEW_REQUIRED,
          paymentId: payment.id,
        };
      }

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
              authority,
              source,
              transaction,
              PAYMENT_EVENT_STATUS.REVIEW_REQUIRED,
              "INVALID_PAYMENT_STATE",
              payment.id,
              rawPayload,
            ),
          });
          return {
            duplicate: false,
            status: PAYMENT_EVENT_STATUS.REVIEW_REQUIRED,
            paymentId: payment.id,
          };
        }
        const paymentUpdated = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: {
              in: [
                PAYMENT_STATUS.PENDING,
                PAYMENT_STATUS.VERIFYING,
                PAYMENT_STATUS.REVIEW_REQUIRED,
              ],
            },
          },
          data: { status: PAYMENT_STATUS.SUCCEEDED, paidAt: transaction.occurredAt },
        });
        if (paymentUpdated.count === 0)
          throw new AppError("Payment changed while confirming", 409, "PAYMENT_CONFIRMATION_RACE");
        await tx.paymentReviewCase.updateMany({
          where: { paymentId: payment.id, status: "OPEN" },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolution: "PAYMENT_CONFIRMED",
            version: { increment: 1 },
          },
        });
        await tx.paymentWebhookEvent.create({
          data: eventData(
            authority,
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

      // money leaving the shop account never pays an order; keep it for audit, out of the review queue
      if (transaction.direction !== "IN") {
        await tx.paymentWebhookEvent.create({
          data: {
            ...eventData(
              authority,
              source,
              transaction,
              PAYMENT_EVENT_STATUS.RESOLVED,
              PAYMENT_REVIEW_REASON.OUTBOUND,
              payment?.id ?? null,
              rawPayload,
            ),
            resolvedAt: new Date(),
            note: "Outbound transaction ignored automatically",
          },
        });
        return { duplicate: false, status: PAYMENT_EVENT_STATUS.RESOLVED, paymentId: payment?.id };
      }

      await tx.paymentWebhookEvent.create({
        data: eventData(
          authority,
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
      const duplicate = await duplicateEvent(prisma, authority, transaction);
      if (duplicate)
        return {
          duplicate: true,
          status: duplicate.status as IngestPaymentResult["status"],
          paymentId: duplicate.paymentId ?? undefined,
        };
    }
    throw error;
  }
};
