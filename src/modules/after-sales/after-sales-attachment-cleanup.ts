import { prisma } from "config/client";
import type { AttachmentDeps } from "modules/after-sales/after-sales.attachments";

const missingObject = (error: unknown) => {
  const candidate = error as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.code === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
};

export const cleanupServiceAttachment = async (
  deps: AttachmentDeps,
  attachmentId: number,
  now = deps.now?.() ?? new Date(),
) => {
  const attachment = await prisma.serviceRequestAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true, objectKey: true, status: true, storageDeletedAt: true },
  });
  if (!attachment || attachment.status !== "DELETING" || attachment.storageDeletedAt)
    return "noop" as const;
  try {
    await deps.storage.deleteObject(attachment.objectKey);
  } catch (error) {
    if (!missingObject(error)) throw error;
  }
  const updated = await prisma.serviceRequestAttachment.updateMany({
    where: { id: attachment.id, status: "DELETING", storageDeletedAt: null },
    data: { storageDeletedAt: now },
  });
  return updated.count === 1 ? ("deleted" as const) : ("noop" as const);
};

export const reconcileAfterSalesAttachments = async (
  deps: AttachmentDeps,
  input: { now: Date; limit: number; pendingTtlMs: number },
) => {
  const cutoff = new Date(input.now.getTime() - input.pendingTtlMs);
  const stale = await prisma.serviceRequestAttachment.updateMany({
    where: { status: "PENDING", deletedAt: null, updatedAt: { lte: cutoff } },
    data: { status: "DELETING", deletedAt: input.now },
  });
  const rows = await prisma.serviceRequestAttachment.findMany({
    where: { status: "DELETING", storageDeletedAt: null },
    select: { id: true },
    orderBy: { id: "asc" },
    take: input.limit,
  });
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if ((await cleanupServiceAttachment(deps, row.id, input.now)) === "deleted") deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, tombstoned: stale.count, failed };
};
