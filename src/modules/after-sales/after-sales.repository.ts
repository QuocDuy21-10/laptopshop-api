import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { pageArgs, pageMeta } from "lib/http";
import type { DeviceEligibilityQuery } from "modules/after-sales/after-sales.schema";

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
