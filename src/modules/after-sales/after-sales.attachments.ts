import { createHash } from "node:crypto";
import { prisma } from "config/client";
import { AppError } from "lib/errors";
import type { ObjectStorage } from "lib/storage/object-storage";
import { processUploadedImage, type ProcessedImage } from "lib/images/process-uploaded-image";

const MAX_ACTIVE_ATTACHMENTS = 15;
const READ_URL_TTL_SECONDS = 900;
const uploadKeyPattern = /^[A-Za-z0-9_-]{1,64}$/;

type AttachmentActor = { id: number; role: "USER" | "ADMIN" };
export type AttachmentDeps = { storage: ObjectStorage; now?: () => Date };
export type ServiceAttachmentDto = {
  id: number;
  itemId: number | null;
  url: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: Date;
};

const notFound = () =>
  new AppError("Service request item not found", 404, "SERVICE_REQUEST_ITEM_NOT_FOUND");
const validateUploadKey = (uploadKey: string) => {
  if (!uploadKeyPattern.test(uploadKey))
    throw new AppError("Upload-Key is invalid", 400, "UPLOAD_KEY_INVALID");
};

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
): Promise<ServiceAttachmentDto> => ({
  id: row.id,
  itemId: row.serviceRequestItemId,
  url: await deps.storage.getSignedReadUrl(row.objectKey, READ_URL_TTL_SECONDS),
  mimeType: row.mimeType,
  byteSize: row.byteSize,
  width: row.width,
  height: row.height,
  createdAt: row.createdAt,
});

const fingerprintFor = (images: ProcessedImage[]) => {
  const hash = createHash("sha256");
  for (const image of images) {
    hash.update(image.mimeType);
    hash.update(String(image.byteSize));
    hash.update(String(image.width));
    hash.update(String(image.height));
    hash.update(image.buffer);
  }
  return hash.digest("hex");
};

const objectPrefix = (requestId: number, itemId: number, uploadKey: string) =>
  `after-sales/${requestId}/${itemId}/${createHash("sha256").update(uploadKey).digest("hex")}`;

export const addServiceAttachments = async (
  deps: AttachmentDeps,
  actor: AttachmentActor,
  requestId: number,
  itemId: number,
  files: Express.Multer.File[],
  uploadKey: string,
) => {
  validateUploadKey(uploadKey);
  if (!deps.storage)
    throw new AppError("Attachment storage is unavailable", 503, "ATTACHMENT_STORAGE_UNAVAILABLE");
  const preflight = await prisma.serviceRequestItem.findFirst({
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
  if (!preflight) throw notFound();
  if (
    ["CLOSED", "REJECTED", "CANCELLED"].includes(preflight.status) ||
    preflight.request.status === "CLOSED"
  )
    throw new AppError(
      "Attachments are not available in the current state",
      409,
      "INVALID_SERVICE_TRANSITION",
    );
  if (preflight.attachments.length + files.length > MAX_ACTIVE_ATTACHMENTS)
    throw new AppError("Attachment limit reached", 409, "ATTACHMENT_LIMIT_REACHED");
  const processed: ProcessedImage[] = await Promise.all(files.map(processUploadedImage));
  const uploadHash = fingerprintFor(processed);
  const prefix = objectPrefix(requestId, itemId, uploadKey);

  const reservation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM service_request_items WHERE id = ${itemId} FOR UPDATE
    `;
    const item = await tx.serviceRequestItem.findFirst({
      where: {
        id: itemId,
        serviceRequestId: requestId,
        ...(actor.role === "USER" ? { request: { userId: actor.id } } : {}),
      },
      select: { id: true, status: true, request: { select: { userId: true, status: true } } },
    });
    if (!item) throw notFound();
    if (
      ["CLOSED", "REJECTED", "CANCELLED"].includes(item.status) ||
      item.request.status === "CLOSED"
    )
      throw new AppError(
        "Attachments are not available in the current state",
        409,
        "INVALID_SERVICE_TRANSITION",
      );

    const existing = await tx.serviceRequestAttachment.findMany({
      where: { serviceRequestItemId: itemId, uploadKey },
      orderBy: { uploadPosition: "asc" },
    });
    if (existing.length > 0) {
      if (
        existing.length !== files.length ||
        existing.some(
          (row) => row.uploadHash !== uploadHash || row.deletedAt || row.status === "DELETING",
        )
      )
        throw new AppError(
          "Upload-Key was reused with a different or retired payload",
          409,
          "ATTACHMENT_IDEMPOTENCY_CONFLICT",
        );
      return { rows: existing, ready: existing.every((row) => row.status === "READY") };
    }

    const activeCount = await tx.serviceRequestAttachment.count({
      where: {
        serviceRequestItemId: itemId,
        deletedAt: null,
        status: { in: ["PENDING", "READY"] },
      },
    });
    if (activeCount + files.length > MAX_ACTIVE_ATTACHMENTS)
      throw new AppError("Attachment limit reached", 409, "ATTACHMENT_LIMIT_REACHED");

    const rows = await Promise.all(
      processed.map((image, index) =>
        tx.serviceRequestAttachment.create({
          data: {
            serviceRequestId: requestId,
            serviceRequestItemId: itemId,
            uploadedById: actor.id,
            uploadKey,
            uploadHash,
            uploadPosition: index,
            objectKey: `${prefix}/${uploadHash}-${index}.webp`,
            mimeType: image.mimeType,
            byteSize: image.byteSize,
            width: image.width,
            height: image.height,
            status: "PENDING",
          },
        }),
      ),
    );
    return { rows, ready: false };
  });

  if (!reservation.ready) {
    const uploads = await Promise.allSettled(
      reservation.rows.map((row, index) =>
        deps.storage.putObject({
          key: row.objectKey,
          body: processed[index].buffer,
          contentLength: processed[index].byteSize,
          contentType: processed[index].mimeType,
        }),
      ),
    );
    if (uploads.some((result) => result.status === "rejected")) {
      await Promise.allSettled(
        reservation.rows.map((row) => deps.storage.deleteObject(row.objectKey)),
      );
      throw new AppError(
        "Attachment storage is unavailable",
        503,
        "ATTACHMENT_STORAGE_UNAVAILABLE",
      );
    }
    await prisma.serviceRequestAttachment.updateMany({
      where: {
        id: { in: reservation.rows.map((row) => row.id) },
        status: "PENDING",
        deletedAt: null,
      },
      data: { status: "READY" },
    });
  }

  const ready = await prisma.serviceRequestAttachment.findMany({
    where: { id: { in: reservation.rows.map((row) => row.id) }, status: "READY", deletedAt: null },
    orderBy: { uploadPosition: "asc" },
  });
  return Promise.all(ready.map((row) => toDto(deps, row)));
};

export const listServiceAttachments = async (
  deps: AttachmentDeps,
  actor: AttachmentActor,
  requestId: number,
  itemId: number,
) => {
  const item = await prisma.serviceRequestItem.findFirst({
    where: {
      id: itemId,
      serviceRequestId: requestId,
      ...(actor.role === "USER" ? { request: { userId: actor.id } } : {}),
    },
    select: { id: true },
  });
  if (!item) throw notFound();
  const rows = await prisma.serviceRequestAttachment.findMany({
    where: { serviceRequestItemId: itemId, status: "READY", deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return Promise.all(rows.map((row) => toDto(deps, row)));
};

export const redactServiceAttachment = async (
  actor: AttachmentActor,
  requestId: number,
  attachmentId: number,
  reason: string,
) => {
  if (!reason.trim())
    throw new AppError("Redaction reason is required", 400, "ATTACHMENT_REDACTION_REASON_REQUIRED");
  await prisma.$transaction(async (tx) => {
    const attachment = await tx.serviceRequestAttachment.findFirst({
      where: {
        id: attachmentId,
        serviceRequestId: requestId,
        ...(actor.role === "USER" ? { uploadedById: actor.id } : {}),
      },
      select: { id: true, objectKey: true, status: true, serviceRequestItemId: true },
    });
    if (!attachment) throw new AppError("Attachment not found", 404, "ATTACHMENT_NOT_FOUND");
    const updated = await tx.serviceRequestAttachment.updateMany({
      where: { id: attachment.id, status: { not: "DELETING" }, deletedAt: null },
      data: { status: "DELETING", deletedAt: new Date() },
    });
    if (updated.count !== 1) return;
    const event = await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        serviceRequestItemId: attachment.serviceRequestItemId,
        actorId: actor.id,
        kind: "ATTACHMENT_REDACTED",
        visibility: "INTERNAL",
        body: reason.trim(),
      },
    });
    await tx.serviceRequestAttachment.update({
      where: { id: attachment.id },
      data: { eventId: event.id },
    });
    await tx.outboxEvent.upsert({
      where: { dedupeKey: `after-sales-attachment-delete:${attachment.id}` },
      create: {
        eventType: "AFTER_SALES_ATTACHMENT_DELETE_REQUESTED",
        aggregateType: "ServiceRequestAttachment",
        aggregateId: attachment.id,
        dedupeKey: `after-sales-attachment-delete:${attachment.id}`,
        payload: { jobType: "ATTACHMENT_DELETE", attachmentId: attachment.id },
      },
      update: {},
    });
  });
};

export type { AttachmentActor };
