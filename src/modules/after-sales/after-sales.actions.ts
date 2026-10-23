import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { toCustomerServiceRequestDto } from "modules/after-sales/after-sales.mapper";
import { deriveRequestStatus } from "modules/after-sales/after-sales.aggregate";
import { customerServiceRequestInclude } from "modules/after-sales/after-sales.repository";
import { assertTransition, type TransitionContext } from "modules/after-sales/after-sales.status";
import { scheduleConfirmationMilestones } from "modules/after-sales/after-sales-maintenance";
import type {
  ServiceRequestItemStatus,
  ServiceRequestType,
} from "modules/after-sales/after-sales.types";

export type AdminActor = { id: number };
export type TransitionItemInput = {
  to: ServiceRequestItemStatus;
  expectedVersion: number;
  note?: string;
  resolution?: string;
  closeMode?: "ADMINISTRATIVE" | "TIMEOUT";
};
export type CompletionDisputeInput = {
  reason: "DEVICE_NOT_RECEIVED" | "ISSUE_PERSISTS";
  note: string;
};

const itemNotFound = () =>
  new AppError("Service request item not found", 404, "SERVICE_REQUEST_ITEM_NOT_FOUND");
const versionConflict = () =>
  new AppError("Service request item changed", 409, "SERVICE_ITEM_VERSION_CONFLICT");

const refreshRequest = async (tx: Prisma.TransactionClient, requestId: number) => {
  const statuses = await tx.serviceRequestItem.findMany({
    where: { serviceRequestId: requestId },
    select: { status: true },
  });
  const status = deriveRequestStatus(statuses.map((item) => item.status as never));
  await tx.serviceRequest.update({
    where: { id: requestId },
    data: {
      status,
      version: { increment: 1 },
      ...(status === "CLOSED" ? { closedAt: new Date() } : {}),
    },
  });
  const row = await tx.serviceRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: customerServiceRequestInclude,
  });
  return toCustomerServiceRequestDto(row);
};

const loadItem = async (tx: Prisma.TransactionClient, requestId: number, itemId: number) => {
  const item = await tx.serviceRequestItem.findFirst({
    where: { id: itemId, serviceRequestId: requestId },
    select: {
      id: true,
      serviceRequestId: true,
      status: true,
      version: true,
      confirmationDueAt: true,
      quotes: { orderBy: { version: "desc" }, take: 1, select: { status: true, validUntil: true } },
      request: { select: { id: true, type: true, userId: true } },
    },
  });
  if (!item) throw itemNotFound();
  return item;
};

export const transitionItem = async (
  actor: AdminActor,
  requestId: number,
  itemId: number,
  input: TransitionItemInput,
) =>
  prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, requestId, itemId);
    if (item.version !== input.expectedVersion) throw versionConflict();
    const now = new Date();
    const context: TransitionContext = {
      now,
      closeMode: input.closeMode,
      confirmationDueAt: item.confirmationDueAt,
      quoteAccepted: item.quotes[0]?.status === "ACCEPTED" && item.quotes[0].validUntil > now,
    };
    assertTransition(
      item.request.type as ServiceRequestType,
      item.status as ServiceRequestItemStatus,
      input.to,
      context,
    );
    if (input.to === "REJECTED" && !input.note?.trim())
      throw new AppError(
        "A rejection reason is required",
        400,
        "SERVICE_REJECTION_REASON_REQUIRED",
      );
    if (["RESOLVED", "READY_FOR_RETURN"].includes(input.to) && !input.resolution?.trim())
      throw new AppError("A resolution is required", 400, "SERVICE_RESOLUTION_REQUIRED");
    if (input.to === "CLOSED" && input.closeMode === "ADMINISTRATIVE" && !input.note?.trim())
      throw new AppError("A close reason is required", 400, "SERVICE_CLOSE_REASON_REQUIRED");
    const data: Prisma.ServiceRequestItemUpdateInput = {
      status: input.to,
      version: { increment: 1 },
      ...(input.resolution ? { resolution: input.resolution.trim() } : {}),
      ...(input.to === "RESOLVED"
        ? { resolvedAt: now, confirmationDueAt: new Date(now.getTime() + 168 * 60 * 60 * 1000) }
        : {}),
      ...(input.to === "RETURNED"
        ? { returnedAt: now, confirmationDueAt: new Date(now.getTime() + 168 * 60 * 60 * 1000) }
        : {}),
      ...(input.to === "CLOSED"
        ? {
            closedAt: now,
            closeReason:
              input.closeMode === "TIMEOUT" ? "CUSTOMER_CONFIRMATION_TIMEOUT" : "ADMINISTRATIVE",
          }
        : {}),
    };
    const updated = await tx.serviceRequestItem.updateMany({
      where: { id: itemId, version: input.expectedVersion },
      data,
    });
    if (updated.count !== 1) throw versionConflict();
    if (input.to === "RETURNED" || input.to === "RESOLVED") {
      await scheduleConfirmationMilestones(tx, {
        id: itemId,
        version: input.expectedVersion + 1,
        returnedAt: input.to === "RETURNED" ? now : null,
        resolvedAt: input.to === "RESOLVED" ? now : null,
      });
    }
    await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        serviceRequestItemId: itemId,
        actorId: actor.id,
        kind:
          input.to === "CLOSED" && input.closeMode === "ADMINISTRATIVE"
            ? "ADMIN_CLOSED"
            : "STATUS_CHANGED",
        fromStatus: item.status,
        toStatus: input.to,
        visibility: "PUBLIC",
        body: input.note?.trim() || input.resolution?.trim(),
      },
    });
    return refreshRequest(tx, requestId);
  });

export const cancelMyItem = async (userId: number, requestId: number, itemId: number) =>
  prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, requestId, itemId);
    if (item.request.userId !== userId)
      throw new AppError("Service request not found", 404, "SERVICE_REQUEST_NOT_FOUND");
    assertTransition(
      item.request.type as ServiceRequestType,
      item.status as ServiceRequestItemStatus,
      "CANCELLED",
    );
    const updated = await tx.serviceRequestItem.updateMany({
      where: { id: itemId, version: item.version },
      data: {
        status: "CANCELLED",
        version: { increment: 1 },
        closedAt: new Date(),
        closeReason: "CUSTOMER_CANCELLED",
      },
    });
    if (updated.count !== 1) throw versionConflict();
    await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        serviceRequestItemId: itemId,
        actorId: userId,
        kind: "STATUS_CHANGED",
        fromStatus: item.status,
        toStatus: "CANCELLED",
        body: "Khách hàng đã hủy thiết bị",
        visibility: "PUBLIC",
      },
    });
    return refreshRequest(tx, requestId);
  });

export const confirmMyItem = async (userId: number, requestId: number, itemId: number) =>
  prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, requestId, itemId);
    if (item.request.userId !== userId)
      throw new AppError("Service request not found", 404, "SERVICE_REQUEST_NOT_FOUND");
    assertTransition(
      item.request.type as ServiceRequestType,
      item.status as ServiceRequestItemStatus,
      "CLOSED",
      { closeMode: "CUSTOMER_CONFIRMATION" },
    );
    const updated = await tx.serviceRequestItem.updateMany({
      where: { id: itemId, version: item.version },
      data: {
        status: "CLOSED",
        version: { increment: 1 },
        closedAt: new Date(),
        customerConfirmedAt: new Date(),
        closeReason: "CUSTOMER_CONFIRMED",
      },
    });
    if (updated.count !== 1) throw versionConflict();
    await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        serviceRequestItemId: itemId,
        actorId: userId,
        kind: "CUSTOMER_CONFIRMED",
        fromStatus: item.status,
        toStatus: "CLOSED",
        body: "Khách hàng đã xác nhận hoàn tất",
        visibility: "PUBLIC",
      },
    });
    return refreshRequest(tx, requestId);
  });

export const disputeMyItem = async (
  userId: number,
  requestId: number,
  itemId: number,
  input: CompletionDisputeInput,
) =>
  prisma.$transaction(async (tx) => {
    const item = await loadItem(tx, requestId, itemId);
    if (item.request.userId !== userId)
      throw new AppError("Service request not found", 404, "SERVICE_REQUEST_NOT_FOUND");
    assertTransition(
      item.request.type as ServiceRequestType,
      item.status as ServiceRequestItemStatus,
      "REVIEWING",
    );
    const updated = await tx.serviceRequestItem.updateMany({
      where: { id: itemId, version: item.version },
      data: { status: "REVIEWING", version: { increment: 1 }, confirmationDueAt: null },
    });
    if (updated.count !== 1) throw versionConflict();
    await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        serviceRequestItemId: itemId,
        actorId: userId,
        kind: "COMPLETION_DISPUTED",
        fromStatus: item.status,
        toStatus: "REVIEWING",
        body: `${input.reason}: ${input.note.trim()}`,
        visibility: "PUBLIC",
      },
    });
    return refreshRequest(tx, requestId);
  });
