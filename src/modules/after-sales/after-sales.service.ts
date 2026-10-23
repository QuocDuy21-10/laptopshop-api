import { createHash, randomUUID } from "node:crypto";
import { prisma } from "config/client";
import { AppError, isUniqueViolation } from "lib/errors";
import {
  toCustomerServiceRequestDto,
  toEligibleDeviceDto,
} from "modules/after-sales/after-sales.mapper";
import { classifyCoverage } from "modules/after-sales/after-sales.eligibility";
import {
  customerServiceRequestInclude,
  lockOrderDetails,
} from "modules/after-sales/after-sales.repository";
import { listEligibleDeviceRows } from "modules/after-sales/after-sales.repository";
import type {
  CreateServiceRequestBody,
  DeviceEligibilityQuery,
} from "modules/after-sales/after-sales.schema";

const requestHashFor = (input: CreateServiceRequestBody) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

const normalizeSerial = (value: string | undefined) => value?.trim().toLowerCase() ?? null;

const requestCode = () => `AS-${Date.now()}-${randomUUID().slice(0, 8)}`;

export const listMyEligibleDevices = async (userId: number, query: DeviceEligibilityQuery) => {
  const result = await listEligibleDeviceRows(userId, query);
  return {
    items: result.rows.map((row) => toEligibleDeviceDto(row, query.type)),
    meta: result.meta,
  };
};

export const createServiceRequest = async (
  userId: number,
  idempotencyKey: string,
  input: CreateServiceRequestBody,
): Promise<{ request: ReturnType<typeof toCustomerServiceRequestDto>; created: boolean }> => {
  const requestHash = requestHashFor(input);
  const existing = await prisma.serviceRequest.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: customerServiceRequestInclude,
  });
  if (existing) {
    if (existing.requestHash !== requestHash)
      throw new AppError(
        "Idempotency key was reused with a different request",
        409,
        "IDEMPOTENCY_KEY_REUSED",
      );
    const replay = await prisma.serviceRequest.findUniqueOrThrow({
      where: { id: existing.id },
      include: customerServiceRequestInclude,
    });
    return { request: toCustomerServiceRequestDto(replay), created: false };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const details = await lockOrderDetails(
        tx,
        input.items.map((item) => item.orderDetailId),
      );
      if (details.length !== input.items.length)
        throw new AppError(
          "One or more order details were not found",
          404,
          "ORDER_DETAIL_NOT_ELIGIBLE",
        );

      const detailById = new Map(details.map((detail) => [detail.id, detail]));
      const itemData = input.items.map((inputItem, position) => {
        const detail = detailById.get(inputItem.orderDetailId)!;
        if (
          detail.order.userId !== userId ||
          detail.order.status !== "COMPLETED" ||
          detail.order.paymentStatus !== "PAYMENT_SUCCESS"
        )
          throw new AppError(
            "Order detail is not eligible for after-sales",
            409,
            "ORDER_DETAIL_NOT_ELIGIBLE",
          );
        const coverage = classifyCoverage({
          months: detail.warrantyMonthsSnapshot,
          startAt: detail.warrantyStartAt,
          endAt: detail.warrantyEndAt,
        });
        if (
          input.type === "WARRANTY" &&
          coverage !== "IN_WARRANTY" &&
          coverage !== "REQUIRES_VERIFICATION"
        )
          throw new AppError(
            "Warranty is not available for this device",
            409,
            coverage === "OUT_OF_WARRANTY" ? "WARRANTY_EXPIRED" : "WARRANTY_NOT_AVAILABLE",
          );
        const activeCount = detail.serviceRequestItems.length;
        if (activeCount + 1 > detail.quantity)
          throw new AppError(
            "Active after-sales request limit reached",
            409,
            "ACTIVE_DEVICE_LIMIT_REACHED",
          );
        const serialNumberNormalized = normalizeSerial(inputItem.serialNumber);
        if (
          serialNumberNormalized &&
          detail.serviceRequestItems.some(
            (item) => item.serialNumberNormalized === serialNumberNormalized,
          )
        )
          throw new AppError(
            "This device serial already has an active request",
            409,
            "DUPLICATE_ACTIVE_SERIAL",
          );
        return {
          orderDetailId: detail.id,
          position,
          productNameSnapshot: detail.product.name,
          deviceLabel: inputItem.deviceLabel,
          serialNumber: inputItem.serialNumber?.trim() || null,
          serialNumberNormalized,
          issueDescription: inputItem.issueDescription,
          coverageAtCreation: coverage,
        };
      });

      if (input.previousRequestId !== undefined) {
        const previous = await tx.serviceRequest.findFirst({
          where: { id: input.previousRequestId, userId, status: "CLOSED" },
          select: { id: true },
        });
        if (!previous)
          throw new AppError(
            "Previous service request is invalid",
            409,
            "SERVICE_REQUEST_PREVIOUS_INVALID",
          );
      }

      const created = await tx.serviceRequest.create({
        data: {
          code: requestCode(),
          userId,
          type: input.type,
          subject: input.subject,
          previousRequestId: input.previousRequestId,
          idempotencyKey,
          requestHash,
          items: { create: itemData },
          events: { create: { actorId: userId, kind: "REQUEST_CREATED", body: input.subject } },
        },
        select: { id: true },
      });
      return tx.serviceRequest.findUniqueOrThrow({
        where: { id: created.id },
        include: customerServiceRequestInclude,
      });
    });
    return { request: toCustomerServiceRequestDto(created), created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.serviceRequest.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: customerServiceRequestInclude,
    });
    if (winner && winner.requestHash === requestHash)
      return { request: toCustomerServiceRequestDto(winner), created: false };
    throw error;
  }
};
