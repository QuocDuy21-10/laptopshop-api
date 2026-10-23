import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { pageArgs, pageMeta, type PageQuery } from "lib/http";
import type { DeviceEligibilityQuery } from "modules/after-sales/after-sales.schema";

export const customerServiceRequestInclude = {
  items: {
    include: {
      orderDetail: { select: { id: true, orderId: true } },
      quotes: { include: { lines: true }, orderBy: { version: "desc" } },
    },
    orderBy: { position: "asc" },
  },
  events: {
    where: { visibility: "PUBLIC" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  previousRequest: {
    select: { id: true, code: true, type: true, status: true, subject: true, createdAt: true },
  },
  followUps: {
    select: { id: true, code: true, type: true, status: true, subject: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
} satisfies Prisma.ServiceRequestInclude;

export type CustomerServiceRequestRow = Prisma.ServiceRequestGetPayload<{
  include: typeof customerServiceRequestInclude;
}>;

export const eligibleDeviceInclude = {
  order: {
    select: { id: true, userId: true, status: true, paymentStatus: true, completedAt: true },
  },
  product: { select: { id: true, name: true, image: true } },
  serviceRequestItems: {
    where: { status: { notIn: ["CLOSED", "REJECTED", "CANCELLED"] } },
    select: { id: true },
  },
} satisfies Prisma.OrderDetailInclude;

export type EligibleDeviceRow = Prisma.OrderDetailGetPayload<{
  include: typeof eligibleDeviceInclude;
}>;

export const listEligibleDeviceRows = async (userId: number, query: DeviceEligibilityQuery) => {
  const where: Prisma.OrderDetailWhereInput = {
    order: { userId, status: "COMPLETED", paymentStatus: "PAYMENT_SUCCESS" },
  };
  const [total, rows] = await Promise.all([
    prisma.orderDetail.count({ where }),
    prisma.orderDetail.findMany({
      where,
      include: eligibleDeviceInclude,
      orderBy: [{ orderId: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return { rows, meta: pageMeta(query, total) };
};

export const lockOrderDetails = async (tx: Prisma.TransactionClient, ids: number[]) => {
  const sortedIds = [...new Set(ids)].sort((a, b) => a - b);
  await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM order_detail
    WHERE id IN (${Prisma.join(sortedIds)})
    ORDER BY id
    FOR UPDATE
  `;
  return tx.orderDetail.findMany({
    where: { id: { in: sortedIds } },
    include: {
      order: { select: { id: true, userId: true, status: true, paymentStatus: true } },
      product: { select: { name: true } },
      serviceRequestItems: {
        where: { status: { notIn: ["CLOSED", "REJECTED", "CANCELLED"] } },
        select: { id: true, serialNumberNormalized: true },
      },
    },
    orderBy: { id: "asc" },
  });
};

export const listCustomerServiceRequests = async (userId: number, query: PageQuery) => {
  const where = { userId };
  const [total, rows] = await Promise.all([
    prisma.serviceRequest.count({ where }),
    prisma.serviceRequest.findMany({
      where,
      include: customerServiceRequestInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return { rows, meta: pageMeta(query, total) };
};

export const findCustomerServiceRequest = async (userId: number, id: number) =>
  prisma.serviceRequest.findFirst({
    where: { id, userId },
    include: customerServiceRequestInclude,
  });
