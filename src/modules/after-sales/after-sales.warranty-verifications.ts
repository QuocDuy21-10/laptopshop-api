import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError } from "lib/errors";
import { toAdminServiceRequestDto } from "modules/after-sales/after-sales.mapper";
import { adminServiceRequestInclude } from "modules/after-sales/after-sales.repository";
import type { WarrantyVerificationBody } from "modules/after-sales/after-sales.schema";

type WarrantyVerificationRow = {
  id: number;
  decision: "IN_WARRANTY" | "OUT_OF_WARRANTY" | "NO_WARRANTY" | "UNVERIFIABLE";
  warrantyStartAt: Date | null;
  warrantyEndAt: Date | null;
  createdAt: Date;
  internalNote?: string | null;
  verifiedBy?: { id: number; username: string; fullName: string | null } | null;
};

export const toCustomerWarrantyVerificationDto = (row: WarrantyVerificationRow | null) =>
  row
    ? {
        id: row.id,
        decision: row.decision,
        warrantyStartAt: row.warrantyStartAt,
        warrantyEndAt: row.warrantyEndAt,
        verifiedAt: row.createdAt,
      }
    : null;

export const toAdminWarrantyVerificationDto = (row: WarrantyVerificationRow | null) =>
  row
    ? {
        ...toCustomerWarrantyVerificationDto(row),
        verifiedBy: row.verifiedBy ?? null,
        internalNote: row.internalNote ?? null,
      }
    : null;

const versionConflict = () =>
  new AppError("Service request item changed", 409, "SERVICE_ITEM_VERSION_CONFLICT");

export const createWarrantyVerification = async (
  adminId: number,
  requestId: number,
  itemId: number,
  input: WarrantyVerificationBody,
) =>
  prisma.$transaction(async (tx) => {
    const item = await tx.serviceRequestItem.findFirst({
      where: { id: itemId, serviceRequestId: requestId },
      select: {
        id: true,
        serviceRequestId: true,
        orderDetailId: true,
        version: true,
        request: { select: { type: true } },
      },
    });
    if (!item)
      throw new AppError("Service request item not found", 404, "SERVICE_REQUEST_ITEM_NOT_FOUND");
    if (item.request.type !== "WARRANTY")
      throw new AppError(
        "Warranty verification is only available for warranty items",
        409,
        "SERVICE_REQUEST_TYPE_MISMATCH",
      );
    if (item.version !== input.expectedVersion) throw versionConflict();

    const updated = await tx.serviceRequestItem.updateMany({
      where: { id: itemId, version: input.expectedVersion },
      data: { version: { increment: 1 } },
    });
    if (updated.count !== 1) throw versionConflict();

    await tx.warrantyVerification.create({
      data: {
        orderDetailId: item.orderDetailId,
        serviceRequestItemId: item.id,
        decision: input.decision,
        warrantyStartAt: input.warrantyStartAt ?? null,
        warrantyEndAt: input.warrantyEndAt ?? null,
        verifiedById: adminId,
        internalNote: input.note?.trim() || null,
      },
    });
    await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        serviceRequestItemId: itemId,
        actorId: adminId,
        kind: "WARRANTY_VERIFIED",
        visibility: "PUBLIC",
        body: `Đã xác minh bảo hành: ${input.decision}`,
      },
    });

    const row = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: adminServiceRequestInclude,
    });
    return toAdminServiceRequestDto(row);
  });

export type WarrantyVerificationTransaction = Prisma.TransactionClient;
