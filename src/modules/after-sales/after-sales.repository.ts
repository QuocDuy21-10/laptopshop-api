import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { pageArgs, pageMeta, type PageQuery } from "lib/http";
import type { DeviceEligibilityQuery } from "modules/after-sales/after-sales.schema";
import type { AdminServiceRequestQuery } from "modules/after-sales/after-sales.schema";

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

export const adminServiceRequestInclude = {
  items: {
    include: {
      orderDetail: { select: { id: true, orderId: true } },
      quotes: { include: { lines: true }, orderBy: { version: "desc" } },
    },
    orderBy: { position: "asc" },
  },
  events: {
    include: { actor: { select: { id: true, fullName: true, username: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  previousRequest: {
    select: { id: true, code: true, type: true, status: true, subject: true, createdAt: true },
  },
  followUps: {
    select: { id: true, code: true, type: true, status: true, subject: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
  customer: { select: { id: true, username: true, fullName: true, phone: true, address: true } },
  assignee: { select: { id: true, username: true, fullName: true } },
} satisfies Prisma.ServiceRequestInclude;

export type AdminServiceRequestRow = Prisma.ServiceRequestGetPayload<{
  include: typeof adminServiceRequestInclude;
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

export const listAdminServiceRequests = async (query: AdminServiceRequestQuery) => {
  const where: Prisma.ServiceRequestWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.assigneeId ? { assignedToId: query.assigneeId } : {}),
    ...(query.itemStatus ? { items: { some: { status: query.itemStatus as never } } } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lt: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
    ...(query.q
      ? {
          OR: [
            { code: { contains: query.q } },
            { subject: { contains: query.q } },
            { customer: { username: { contains: query.q } } },
            { customer: { fullName: { contains: query.q } } },
            { items: { some: { productNameSnapshot: { contains: query.q } } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.serviceRequest.count({ where }),
    prisma.serviceRequest.findMany({
      where,
      include: adminServiceRequestInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  return { rows, meta: pageMeta(query, total) };
};

export const findAdminServiceRequest = async (id: number) =>
  prisma.serviceRequest.findUnique({ where: { id }, include: adminServiceRequestInclude });

export const listAfterSalesAssignees = () =>
  prisma.user.findMany({
    where: { role: { name: "ADMIN" } },
    select: { id: true, fullName: true, username: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
  });
