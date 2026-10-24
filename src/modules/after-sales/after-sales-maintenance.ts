import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { deriveRequestStatus } from "modules/after-sales/after-sales.aggregate";
import { createAfterSalesNotification } from "modules/after-sales/after-sales.notifications";

export type Milestone = "REMIND_72H" | "REMIND_144H" | "AUTO_CLOSE_168H";
type ItemForSchedule = {
  id: number;
  version: number;
  returnedAt: Date | null;
  resolvedAt: Date | null;
};

const delayHours: Record<Milestone, number> = {
  REMIND_72H: 72,
  REMIND_144H: 144,
  AUTO_CLOSE_168H: 168,
};

export const scheduleConfirmationMilestones = async (
  tx: Pick<Prisma.TransactionClient, "outboxEvent">,
  item: ItemForSchedule,
) => {
  const anchor = item.returnedAt ?? item.resolvedAt;
  if (!anchor) return;
  await Promise.all(
    (Object.keys(delayHours) as Milestone[]).map((milestone) => {
      const availableAt = new Date(anchor.getTime() + delayHours[milestone] * 60 * 60 * 1000);
      return tx.outboxEvent.create({
        data: {
          eventType: "AFTER_SALES_MILESTONE_REQUESTED",
          aggregateType: "ServiceRequestItem",
          aggregateId: item.id,
          dedupeKey: `after-sales-milestone:${item.id}:${item.version}:${milestone}`,
          payload: { jobType: "MILESTONE", itemId: item.id, itemVersion: item.version, milestone },
          availableAt,
        },
      });
    }),
  );
};

export const processAfterSalesMilestone = async (
  input: { itemId: number; itemVersion: number; milestone: Milestone },
  now = new Date(),
) => {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM service_request_items WHERE id = ${input.itemId} FOR UPDATE
    `;
    const item = await tx.serviceRequestItem.findUnique({
      where: { id: input.itemId },
      select: {
        id: true,
        serviceRequestId: true,
        version: true,
        status: true,
        confirmationDueAt: true,
        request: { select: { userId: true, assignedToId: true } },
      },
    });
    if (
      !item ||
      item.version !== input.itemVersion ||
      !["RETURNED", "RESOLVED"].includes(item.status) ||
      !item.confirmationDueAt
    )
      return "noop" as const;
    if (input.milestone === "AUTO_CLOSE_168H" && item.confirmationDueAt > now)
      return "noop" as const;
    const reminderDueAt = new Date(
      item.confirmationDueAt.getTime() -
        (input.milestone === "REMIND_72H" ? 96 : input.milestone === "REMIND_144H" ? 24 : 0) *
          60 *
          60 *
          1000,
    );
    if (input.milestone !== "AUTO_CLOSE_168H" && now < reminderDueAt) return "noop" as const;
    if (input.milestone !== "AUTO_CLOSE_168H") {
      await createAfterSalesNotification(tx, {
        event: "CONFIRMATION_REQUIRED",
        requestId: item.serviceRequestId,
        customerId: item.request.userId,
        assigneeId: item.request.assignedToId,
        type: "AFTER_SALES_CONFIRMATION_REQUIRED",
        title: "Vui lòng xác nhận yêu cầu hậu mãi",
        message:
          input.milestone === "REMIND_72H"
            ? "Bạn còn 4 ngày để xác nhận kết quả xử lý yêu cầu hậu mãi."
            : "Bạn còn 1 ngày để xác nhận kết quả xử lý yêu cầu hậu mãi.",
        dedupeKey: `after-sales-confirmation:${item.id}:${input.itemVersion}:${input.milestone}`,
      });
      return "reminded" as const;
    }
    const updated = await tx.serviceRequestItem.updateMany({
      where: { id: item.id, version: input.itemVersion, status: { in: ["RETURNED", "RESOLVED"] } },
      data: {
        status: "CLOSED",
        version: { increment: 1 },
        closedAt: now,
        closeReason: "CUSTOMER_CONFIRMATION_TIMEOUT",
      },
    });
    if (updated.count !== 1) return "noop" as const;
    await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: item.serviceRequestId,
        serviceRequestItemId: item.id,
        kind: "AUTO_CLOSED",
        visibility: "PUBLIC",
        toStatus: "CLOSED",
        body: "Tự động đóng do khách không xác nhận trong 7 ngày",
      },
    });
    const statuses = await tx.serviceRequestItem.findMany({
      where: { serviceRequestId: item.serviceRequestId },
      select: { status: true },
    });
    await tx.serviceRequest.update({
      where: { id: item.serviceRequestId },
      data: {
        status: deriveRequestStatus(statuses.map((row) => row.status as never)),
        version: { increment: 1 },
      },
    });
    await createAfterSalesNotification(tx, {
      event: "ADMIN_STATUS",
      requestId: item.serviceRequestId,
      customerId: item.request.userId,
      assigneeId: item.request.assignedToId,
      type: "AFTER_SALES_AUTO_CLOSED",
      title: "Yêu cầu hậu mãi đã tự động đóng",
      message: "Yêu cầu đã tự động đóng do quá hạn xác nhận 7 ngày.",
      dedupeKey: `after-sales-auto-closed:${item.id}:${input.itemVersion}`,
    });
    return "closed" as const;
  });
};

export const expireDueQuotes = async (now = new Date(), limit = 100) => {
  const due = await prisma.serviceQuote.findMany({
    where: { status: "SENT", validUntil: { lte: now } },
    select: { id: true },
    take: limit,
  });
  if (!due.length) return 0;
  const result = await prisma.serviceQuote.updateMany({
    where: { id: { in: due.map((quote) => quote.id) }, status: "SENT", validUntil: { lte: now } },
    data: { status: "EXPIRED" },
  });
  return result.count;
};
