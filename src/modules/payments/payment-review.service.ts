import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, notFound } from "lib/errors";
import { pageArgs, pageMeta } from "lib/http";
import { cancelOrder } from "modules/orders/order-cancellation.service";
import { ORDER_STATUS } from "modules/orders/order-status";
import { PaymentReviewCaseQuery } from "modules/payments/payments.schema";

const reviewInclude = {
  payment: {
    select: {
      id: true,
      orderId: true,
      status: true,
      amount: true,
      transferCode: true,
      expiresAt: true,
      reviewAfter: true,
      order: { select: { status: true, paymentMethod: true, paymentStatus: true } },
    },
  },
} satisfies Prisma.PaymentReviewCaseInclude;

type ReviewRow = Prisma.PaymentReviewCaseGetPayload<{ include: typeof reviewInclude }>;

const toPaymentReviewCaseDto = (row: ReviewRow) => ({
  id: row.id,
  paymentId: row.paymentId,
  reason: row.reason,
  status: row.status,
  version: row.version,
  openedAt: row.openedAt,
  nextReviewAt: row.nextReviewAt,
  resolvedAt: row.resolvedAt,
  resolution: row.resolution,
  payment: {
    id: row.payment.id,
    orderId: row.payment.orderId,
    status: row.payment.status,
    amount: row.payment.amount,
    transferCode: row.payment.transferCode,
    expiresAt: row.payment.expiresAt,
    reviewAfter: row.payment.reviewAfter,
    order: row.payment.order,
  },
});

export const listPaymentReviewCases = async (q: PaymentReviewCaseQuery) => {
  const where: Prisma.PaymentReviewCaseWhereInput = q.status ? { status: q.status } : {};
  const [total, rows] = await Promise.all([
    prisma.paymentReviewCase.count({ where }),
    prisma.paymentReviewCase.findMany({
      where,
      include: reviewInclude,
      orderBy: { openedAt: "desc" },
      ...pageArgs(q),
    }),
  ]);
  return { items: rows.map(toPaymentReviewCaseDto), meta: pageMeta(q, total) };
};

export const getPaymentReviewCase = async (id: string) => {
  const row = await prisma.paymentReviewCase.findUnique({ where: { id }, include: reviewInclude });
  if (!row) throw notFound("Payment review case");
  return toPaymentReviewCaseDto(row);
};

const versionConflict = () =>
  new AppError("Payment review case changed", 409, "PAYMENT_REVIEW_CASE_VERSION_CONFLICT");

export const extendPaymentReviewCase = async (
  id: string,
  actorId: number,
  input: { note: string; holdUntil: string; version: number },
) => {
  const holdUntil = new Date(input.holdUntil);
  if (!Number.isFinite(holdUntil.getTime()) || holdUntil <= new Date())
    throw new AppError("Hold deadline must be in the future", 400, "PAYMENT_REVIEW_HOLD_INVALID");
  await prisma.$transaction(async (tx) => {
    const updated = await tx.paymentReviewCase.updateMany({
      where: { id, status: "OPEN", version: input.version },
      data: { nextReviewAt: holdUntil, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw versionConflict();
    const row = await tx.paymentReviewCase.findUniqueOrThrow({ where: { id } });
    await tx.paymentReviewAction.create({
      data: { reviewCaseId: id, actorId, action: "EXTEND_HOLD", note: input.note, holdUntil },
    });
    return row;
  });
  return getPaymentReviewCase(id);
};

export const releasePaymentReviewCase = async (
  id: string,
  actorId: number,
  input: { note: string; confirmation: "RELEASE_STOCK"; version: number },
) => {
  await prisma.$transaction(async (tx) => {
    const row = await tx.paymentReviewCase.findUnique({
      where: { id },
      include: reviewInclude,
    });
    if (!row || row.status !== "OPEN" || row.version !== input.version) throw versionConflict();
    const marked = await tx.paymentReviewCase.updateMany({
      where: { id, status: "OPEN", version: input.version },
      data: {
        status: "RESOLVED",
        resolution: "RELEASED_UNVERIFIED",
        resolvedAt: new Date(),
        resolvedById: actorId,
        version: { increment: 1 },
      },
    });
    if (marked.count !== 1) throw versionConflict();
    await cancelOrder(tx, {
      orderId: row.payment.orderId,
      actorId,
      from: [ORDER_STATUS.PENDING],
      paymentDisposition: "CANCEL",
      allowVerificationCancel: true,
      reason: "PAYMENT_REVIEW_RELEASED",
      now: new Date(),
    });
    await tx.paymentReviewAction.create({
      data: { reviewCaseId: id, actorId, action: "RELEASE_STOCK", note: input.note },
    });
  });
  return getPaymentReviewCase(id);
};
