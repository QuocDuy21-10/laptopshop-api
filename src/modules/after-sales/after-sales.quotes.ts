import { prisma } from "config/client";
import { AppError } from "lib/errors";
import {
  toAdminServiceRequestDto,
  toCustomerServiceRequestDto,
} from "modules/after-sales/after-sales.mapper";
import { deriveRequestStatus } from "modules/after-sales/after-sales.aggregate";
import {
  customerServiceRequestInclude,
  adminServiceRequestInclude,
} from "modules/after-sales/after-sales.repository";
import { createAfterSalesNotification } from "modules/after-sales/after-sales.notifications";

export type QuoteLineInput = { description: string; quantity: number; unitPrice: number };
export type SendQuoteInput = {
  expectedVersion: number;
  validDays: number;
  note?: string;
  lines: QuoteLineInput[];
};

export const calculateQuote = (lines: QuoteLineInput[]) => {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  return { subtotal, total: subtotal };
};

export const effectiveQuoteStatus = (
  quote: { status: string; validUntil: Date },
  now = new Date(),
) => (quote.status === "SENT" && quote.validUntil <= now ? "EXPIRED" : quote.status);

const quoteConflict = () => new AppError("Quote decision conflict", 409, "QUOTE_VERSION_CONFLICT");

export const sendQuote = async (
  adminId: number,
  requestId: number,
  itemId: number,
  input: SendQuoteInput,
) => {
  const result = await prisma.$transaction(async (tx) => {
    const item = await tx.serviceRequestItem.findFirst({
      where: { id: itemId, serviceRequestId: requestId },
      include: {
        request: { select: { id: true, type: true, userId: true } },
        quotes: { select: { id: true, version: true, status: true } },
      },
    });
    if (!item)
      throw new AppError("Service request item not found", 404, "SERVICE_REQUEST_ITEM_NOT_FOUND");
    if (item.request.type !== "TECHNICAL_SUPPORT")
      throw new AppError(
        "Quotes are not available for warranty items",
        409,
        "SERVICE_REQUEST_TYPE_MISMATCH",
      );
    if (item.version !== input.expectedVersion)
      throw new AppError("Service request item changed", 409, "SERVICE_ITEM_VERSION_CONFLICT");
    if (!["DIAGNOSING", "AWAITING_QUOTE_DECISION"].includes(item.status))
      throw new AppError(
        "Quote cannot be sent in the current state",
        409,
        "INVALID_SERVICE_TRANSITION",
      );
    const totals = calculateQuote(input.lines);
    const now = new Date();
    const version = Math.max(0, ...item.quotes.map((quote) => quote.version)) + 1;
    const itemUpdated = await tx.serviceRequestItem.updateMany({
      where: {
        id: itemId,
        version: input.expectedVersion,
        status: { in: ["DIAGNOSING", "AWAITING_QUOTE_DECISION"] },
      },
      data: { status: "AWAITING_QUOTE_DECISION", version: { increment: 1 } },
    });
    if (itemUpdated.count !== 1)
      throw new AppError("Service request item changed", 409, "SERVICE_ITEM_VERSION_CONFLICT");
    await tx.serviceQuote.updateMany({
      where: { serviceRequestItemId: itemId, status: "SENT" },
      data: { status: "SUPERSEDED" },
    });
    await tx.serviceQuote.create({
      data: {
        serviceRequestItemId: itemId,
        version,
        status: "SENT",
        currency: "VND",
        subtotal: totals.subtotal,
        total: totals.total,
        note: input.note?.trim() || null,
        validUntil: new Date(now.getTime() + input.validDays * 24 * 60 * 60 * 1000),
        createdById: adminId,
        lines: {
          create: input.lines.map((line, position) => ({
            ...line,
            lineTotal: line.quantity * line.unitPrice,
            position,
          })),
        },
      },
    });
    await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        serviceRequestItemId: itemId,
        actorId: adminId,
        kind: "QUOTE_SENT",
        visibility: "PUBLIC",
        body: `Đã gửi báo giá phiên bản ${version}`,
      },
    });
    await createAfterSalesNotification(tx, {
      event: "QUOTE_SENT",
      requestId,
      customerId: item.request.userId,
      assigneeId: null,
      type: "AFTER_SALES_QUOTE_SENT",
      title: "Có báo giá mới",
      message: `Báo giá phiên bản ${version} đang chờ bạn quyết định`,
      dedupeKey: `after-sales-quote:${itemId}:${version}`,
    });
    const statuses = await tx.serviceRequestItem.findMany({
      where: { serviceRequestId: requestId },
      select: { status: true },
    });
    await tx.serviceRequest.update({
      where: { id: requestId },
      data: {
        status: deriveRequestStatus(statuses.map((row) => row.status as never)),
        version: { increment: 1 },
      },
    });
    const row = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: adminServiceRequestInclude,
    });
    return toAdminServiceRequestDto(row);
  });
  return result;
};

export const decideQuote = async (
  userId: number,
  requestId: number,
  itemId: number,
  quoteId: number,
  decision: "ACCEPT" | "DECLINE",
) => {
  const result = await prisma.$transaction(async (tx) => {
    const quote = await tx.serviceQuote.findFirst({
      where: {
        id: quoteId,
        serviceRequestItemId: itemId,
        item: { serviceRequestId: requestId, request: { userId } },
      },
      select: { id: true, status: true, validUntil: true, serviceRequestItemId: true },
    });
    if (!quote) throw new AppError("Quote not found", 404, "QUOTE_NOT_FOUND");
    const current = effectiveQuoteStatus(quote);
    if (current === "EXPIRED") {
      await tx.serviceQuote.updateMany({
        where: { id: quote.id, status: "SENT" },
        data: { status: "EXPIRED" },
      });
      return { expired: true as const };
    }
    const target = decision === "ACCEPT" ? "ACCEPTED" : "DECLINED";
    if (quote.status === target) {
      const row = await tx.serviceRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: customerServiceRequestInclude,
      });
      return toCustomerServiceRequestDto(row);
    }
    if (quote.status !== "SENT") throw quoteConflict();
    const updated = await tx.serviceQuote.updateMany({
      where: { id: quote.id, status: "SENT", validUntil: { gt: new Date() } },
      data: { status: target, respondedAt: new Date() },
    });
    if (updated.count !== 1) throw quoteConflict();
    await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        serviceRequestItemId: itemId,
        actorId: userId,
        kind: "QUOTE_DECIDED",
        visibility: "PUBLIC",
        body:
          decision === "ACCEPT"
            ? "Khách hàng đã chấp nhận báo giá"
            : "Khách hàng đã từ chối báo giá",
      },
    });
    const row = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: customerServiceRequestInclude,
    });
    return toCustomerServiceRequestDto(row);
  });
  if ("expired" in result) throw new AppError("Quote has expired", 409, "QUOTE_EXPIRED");
  return result;
};
