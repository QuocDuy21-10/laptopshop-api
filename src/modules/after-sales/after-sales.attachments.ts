import { randomUUID } from "node:crypto";
import { prisma } from "config/client";
import { AppError } from "lib/errors";
import type { ObjectStorage } from "lib/storage/object-storage";
import { processUploadedImage, type ProcessedImage } from "lib/images/process-uploaded-image";

const MAX_ACTIVE_ATTACHMENTS = 15;
const READ_URL_TTL_SECONDS = 900;

type AttachmentActor = { id: number; role: "USER" | "ADMIN" };
export type AttachmentDeps = { storage: ObjectStorage; now?: () => Date };

const nowOf = (deps: AttachmentDeps) => deps.now?.() ?? new Date();
const notFound = () =>
  new AppError("Service request item not found", 404, "SERVICE_REQUEST_ITEM_NOT_FOUND");

const toDto = async (
  deps: AttachmentDeps,
  row: {
    id: number;
    serviceRequestItemId: number | null;
    objectKey: string;
    mimeType: string;
    byteSize: number;
    width: number;
    height: number;
    createdAt: Date;
  },
) => ({
  id: row.id,
  itemId: row.serviceRequestItemId,
  url: await deps.storage.getSignedReadUrl(row.objectKey, READ_URL_TTL_SECONDS),
  mimeType: row.mimeType,
  byteSize: row.byteSize,
  width: row.width,
  height: row.height,
  createdAt: row.createdAt,
});

export const addServiceAttachments = async (
  deps: AttachmentDeps,
  actor: AttachmentActor,
  requestId: number,
  itemId: number,
  files: Express.Multer.File[],
  uploadKey: string,
) => {
  const item = await prisma.serviceRequestItem.findFirst({
    where: {
      id: itemId,
      serviceRequestId: requestId,
      ...(actor.role === "USER" ? { request: { userId: actor.id } } : {}),
    },
    include: {
      request: { select: { userId: true, status: true } },
      attachments: {
        where: { deletedAt: null, status: { in: ["PENDING", "READY"] } },
        select: { id: true },
      },
    },
  });
  if (!item) throw notFound();
  if (["CLOSED", "REJECTED", "CANCELLED"].includes(item.status) || item.request.status === "CLOSED")
    throw new AppError(
      "Attachments are not available in the current state",
      409,
      "INVALID_SERVICE_TRANSITION",
    );
  if (item.attachments.length + files.length > MAX_ACTIVE_ATTACHMENTS)
    throw new AppError("Attachment limit reached", 409, "ATTACHMENT_LIMIT_REACHED");
  if (!deps.storage)
    throw new AppError("Attachment storage is unavailable", 503, "ATTACHMENT_STORAGE_UNAVAILABLE");

  const processed: ProcessedImage[] = await Promise.all(files.map(processUploadedImage));
  const prefix = `after-sales/${requestId}/${itemId}/${uploadKey}`;
  const reservations = await prisma.$transaction(async (tx) => {
    const existing = await tx.serviceRequestAttachment.findMany({
      where: { objectKey: { startsWith: prefix }, deletedAt: null },
      select: { id: true },
    });
    if (existing.length === files.length)
      return tx.serviceRequestAttachment.findMany({
        where: { id: { in: existing.map((row) => row.id) } },
        orderBy: { id: "asc" },
      });
    return Promise.all(
      processed.map((image, index) =>
        tx.serviceRequestAttachment.create({
          data: {
            serviceRequestId: requestId,
            serviceRequestItemId: itemId,
            uploadedById: actor.id,
            objectKey: `${prefix}-${index}-${randomUUID()}.webp`,
            mimeType: image.mimeType,
            byteSize: image.byteSize,
            width: image.width,
            height: image.height,
            status: "PENDING",
          },
        }),
      ),
    );
  });

  const uploads = await Promise.allSettled(
    reservations.map((row, index) =>
      deps.storage.putObject({
        key: row.objectKey,
        body: processed[index].buffer,
        contentLength: processed[index].byteSize,
        contentType: processed[index].mimeType,
      }),
    ),
  );
  if (uploads.some((result) => result.status === "rejected")) {
    await prisma.serviceRequestAttachment.updateMany({
      where: { id: { in: reservations.map((row) => row.id) }, status: "PENDING" },
      data: { status: "DELETING", deletedAt: nowOf(deps) },
    });
    await Promise.allSettled(reservations.map((row) => deps.storage.deleteObject(row.objectKey)));
    throw new AppError("Attachment storage is unavailable", 503, "ATTACHMENT_STORAGE_UNAVAILABLE");
  }
  await prisma.serviceRequestAttachment.updateMany({
    where: { id: { in: reservations.map((row) => row.id) }, status: "PENDING", deletedAt: null },
    data: { status: "READY" },
  });
  const ready = await prisma.serviceRequestAttachment.findMany({
    where: { id: { in: reservations.map((row) => row.id) }, status: "READY", deletedAt: null },
    orderBy: { id: "asc" },
  });
  return Promise.all(ready.map((row) => toDto(deps, row)));
};

export const redactServiceAttachment = async (
  actor: AttachmentActor,
  requestId: number,
  attachmentId: number,
  reason: string,
) => {
  const attachment = await prisma.serviceRequestAttachment.findFirst({
    where: {
      id: attachmentId,
      serviceRequestId: requestId,
      ...(actor.role === "USER" ? { uploadedById: actor.id } : {}),
    },
    select: { id: true, status: true },
  });
  if (!attachment) throw new AppError("Attachment not found", 404, "ATTACHMENT_NOT_FOUND");
  if (!reason.trim())
    throw new AppError("Redaction reason is required", 400, "ATTACHMENT_REDACTION_REASON_REQUIRED");
  await prisma.serviceRequestAttachment.update({
    where: { id: attachment.id },
    data: { status: "DELETING", deletedAt: new Date() },
  });
};
