import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { deriveRequestStatus } from "modules/after-sales/after-sales.aggregate";

type Milestone = "REMIND_72H" | "REMIND_144H" | "AUTO_CLOSE_168H";
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
          payload: { itemId: item.id, itemVersion: item.version, milestone },
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
  if (input.milestone !== "AUTO_CLOSE_168H") return "reminded" as const;
  return prisma.$transaction(async (tx) => {
    const item = await tx.serviceRequestItem.findUnique({
      where: { id: input.itemId },
      select: {
        id: true,
        serviceRequestId: true,
        version: true,
        status: true,
        confirmationDueAt: true,
      },
    });
    if (
      !item ||
      item.version !== input.itemVersion ||
      !["RETURNED", "RESOLVED"].includes(item.status) ||
      !item.confirmationDueAt ||
      item.confirmationDueAt > now
    )
      return "noop" as const;
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
