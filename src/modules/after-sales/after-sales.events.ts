import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { createAfterSalesNotification } from "modules/after-sales/after-sales.notifications";

type EventActor = { id: number; role: "USER" | "ADMIN" };
type MessageInput = { itemId?: number; body: string };

const eventNotAllowed = () =>
  new AppError(
    "Conversation is not available in the current state",
    409,
    "INVALID_SERVICE_TRANSITION",
  );

const eventDto = (event: {
  id: number;
  serviceRequestId: number;
  serviceRequestItemId: number | null;
  kind: string;
  visibility: string;
  body: string | null;
  createdAt: Date;
}) => ({
  id: event.id,
  requestId: event.serviceRequestId,
  itemId: event.serviceRequestItemId,
  kind: event.kind,
  visibility: event.visibility,
  body: event.body,
  createdAt: event.createdAt,
});

const validateMessage = (input: MessageInput) => {
  const body = input.body.trim();
  if (!body) throw new AppError("Message body is required", 400, "MESSAGE_BODY_REQUIRED");
  if (body.length > 5000)
    throw new AppError("Message body is too long", 400, "MESSAGE_BODY_TOO_LONG");
  return body;
};

export const addPublicMessage = async (
  actor: EventActor,
  requestId: number,
  input: MessageInput,
) => {
  const body = validateMessage(input);
  return prisma.$transaction(async (tx) => {
    if (input.itemId !== undefined)
      await tx.$queryRaw`SELECT id FROM service_request_items WHERE id = ${input.itemId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM service_requests WHERE id = ${requestId} FOR UPDATE`;
    const request = await tx.serviceRequest.findFirst({
      where: { id: requestId, ...(actor.role === "USER" ? { userId: actor.id } : {}) },
      select: {
        id: true,
        status: true,
        userId: true,
        assignedToId: true,
        items: { select: { id: true, status: true } },
      },
    });
    if (!request) throw new AppError("Service request not found", 404, "SERVICE_REQUEST_NOT_FOUND");
    if (request.status === "CLOSED") throw eventNotAllowed();
    if (input.itemId !== undefined) {
      const item = request.items.find((candidate) => candidate.id === input.itemId);
      if (!item)
        throw new AppError("Service request item not found", 404, "SERVICE_REQUEST_ITEM_NOT_FOUND");
      if (["CLOSED", "REJECTED", "CANCELLED"].includes(item.status)) throw eventNotAllowed();
    }
    const event = await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        serviceRequestItemId: input.itemId,
        actorId: actor.id,
        kind: "PUBLIC_MESSAGE",
        visibility: "PUBLIC",
        body,
      },
    });
    await createAfterSalesNotification(tx, {
      event: actor.role === "USER" ? "CUSTOMER_MESSAGE" : "ADMIN_STATUS",
      requestId,
      customerId: request.userId,
      assigneeId: request.assignedToId,
      type: "AFTER_SALES_MESSAGE",
      title: "Tin nhắn yêu cầu hậu mãi",
      message: body,
      dedupeKey: `after-sales-message:${event.id}`,
    });
    return eventDto(event);
  });
};

export const addInternalNote = async (adminId: number, requestId: number, input: MessageInput) => {
  const body = validateMessage(input);
  const request = await prisma.serviceRequest.findFirst({
    where: { id: requestId },
    select: { id: true, status: true, items: { select: { id: true, status: true } } },
  });
  if (!request) throw new AppError("Service request not found", 404, "SERVICE_REQUEST_NOT_FOUND");
  if (request.status === "CLOSED") throw eventNotAllowed();
  if (input.itemId !== undefined) {
    const item = request.items.find((candidate) => candidate.id === input.itemId);
    if (!item)
      throw new AppError("Service request item not found", 404, "SERVICE_REQUEST_ITEM_NOT_FOUND");
    if (["CLOSED", "REJECTED", "CANCELLED"].includes(item.status)) throw eventNotAllowed();
  }
  const event = await prisma.serviceRequestEvent.create({
    data: {
      serviceRequestId: requestId,
      serviceRequestItemId: input.itemId,
      actorId: adminId,
      kind: "INTERNAL_NOTE",
      visibility: "INTERNAL",
      body,
    },
  });
  return eventDto(event);
};
