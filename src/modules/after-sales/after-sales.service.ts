import { createHash, randomUUID } from "node:crypto";
import { prisma } from "config/client";
import { AppError, isUniqueViolation } from "lib/errors";
import type { PageQuery } from "lib/http";
import {
  toAdminServiceRequestDto,
  toCustomerServiceRequestDto,
  toEligibleDeviceDto,
} from "modules/after-sales/after-sales.mapper";
import { effectiveCoverage } from "modules/after-sales/after-sales.eligibility";
import {
  customerServiceRequestInclude,
  adminServiceRequestInclude,
  findAdminServiceRequest,
  findCustomerServiceRequest,
  listAdminServiceRequests,
  listAfterSalesAssignees,
  lockOrderDetails,
  listCustomerServiceRequests,
} from "modules/after-sales/after-sales.repository";
import { listEligibleDeviceRows } from "modules/after-sales/after-sales.repository";
import type {
  AdminServiceRequestQuery,
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

export const listMyServiceRequests = async (userId: number, query: PageQuery) => {
  const result = await listCustomerServiceRequests(userId, query);
  return { items: result.rows.map(toCustomerServiceRequestDto), meta: result.meta };
};

export const getMyServiceRequest = async (userId: number, id: number) => {
  const row = await findCustomerServiceRequest(userId, id);
  if (!row) throw new AppError("Service request not found", 404, "SERVICE_REQUEST_NOT_FOUND");
  return toCustomerServiceRequestDto(row);
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
      if (details.length !== new Set(input.items.map((item) => item.orderDetailId)).size)
        throw new AppError(
          "One or more order details were not found",
          404,
          "ORDER_DETAIL_NOT_ELIGIBLE",
        );

      const detailById = new Map(details.map((detail) => [detail.id, detail]));
      const requestedByDetail = new Map<number, number>();
      for (const item of input.items)
        requestedByDetail.set(
          item.orderDetailId,
          (requestedByDetail.get(item.orderDetailId) ?? 0) + 1,
        );
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
        const latestVerification = detail.warrantyVerifications?.[0] ?? null;
        const coverage = effectiveCoverage(
          {
            months: detail.warrantyMonthsSnapshot,
            startAt: detail.warrantyStartAt,
            endAt: detail.warrantyEndAt,
            policySource: detail.warrantyPolicySource,
          },
          latestVerification
            ? {
                decision: latestVerification.decision,
                warrantyStartAt: latestVerification.warrantyStartAt,
                warrantyEndAt: latestVerification.warrantyEndAt,
              }
            : null,
        );
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
        if (activeCount + (requestedByDetail.get(detail.id) ?? 0) > detail.quantity)
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

export const listAdminServiceRequestCases = async (query: AdminServiceRequestQuery) => {
  const result = await listAdminServiceRequests(query);
  return { items: result.rows.map(toAdminServiceRequestDto), meta: result.meta };
};

export const getAdminServiceRequest = async (id: number) => {
  const row = await findAdminServiceRequest(id);
  if (!row) throw new AppError("Service request not found", 404, "SERVICE_REQUEST_NOT_FOUND");
  return toAdminServiceRequestDto(row);
};

export const getAfterSalesAssignees = async () => {
  const rows = await listAfterSalesAssignees();
  return rows.map((row) => ({ id: row.id, name: row.fullName ?? row.username }));
};

export const getAdminServiceRequestSummary = async () => {
  const [total, submitted, reviewing, inProgress, awaitingCustomer, closed] = await Promise.all([
    prisma.serviceRequest.count(),
    prisma.serviceRequest.count({ where: { status: "SUBMITTED" } }),
    prisma.serviceRequest.count({ where: { status: "REVIEWING" } }),
    prisma.serviceRequest.count({ where: { status: "IN_PROGRESS" } }),
    prisma.serviceRequest.count({ where: { status: "AWAITING_CUSTOMER" } }),
    prisma.serviceRequest.count({ where: { status: "CLOSED" } }),
  ]);
  return { total, submitted, reviewing, inProgress, awaitingCustomer, closed };
};

export const assignServiceRequest = async (
  adminId: number,
  requestId: number,
  input: { assignedToId: number | null; expectedVersion: number },
) =>
  prisma.$transaction(async (tx) => {
    const request = await tx.serviceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, version: true, status: true },
    });
    if (!request) throw new AppError("Service request not found", 404, "SERVICE_REQUEST_NOT_FOUND");
    if (request.version !== input.expectedVersion)
      throw new AppError("Service request changed", 409, "SERVICE_REQUEST_VERSION_CONFLICT");
    if (input.assignedToId !== null) {
      const assignee = await tx.user.findFirst({
        where: { id: input.assignedToId, role: { name: "ADMIN" } },
        select: { id: true },
      });
      if (!assignee)
        throw new AppError("Invalid after-sales assignee", 409, "INVALID_AFTER_SALES_ASSIGNEE");
    }
    const updated = await tx.serviceRequest.updateMany({
      where: { id: requestId, version: input.expectedVersion, status: { not: "CLOSED" } },
      data: { assignedToId: input.assignedToId, version: { increment: 1 } },
    });
    if (updated.count !== 1)
      throw new AppError("Service request changed", 409, "SERVICE_REQUEST_VERSION_CONFLICT");
    await tx.serviceRequestEvent.create({
      data: {
        serviceRequestId: requestId,
        actorId: adminId,
        kind: "ASSIGNED",
        visibility: "INTERNAL",
        body:
          input.assignedToId === null
            ? "Đã bỏ phân công"
            : `Đã phân công admin #${input.assignedToId}`,
      },
    });
    const row = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: adminServiceRequestInclude,
    });
    return toAdminServiceRequestDto(row);
  });
