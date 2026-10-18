import { z } from "zod";
import { pageQuery } from "lib/http";
import { ORDER_STATUSES } from "modules/orders/order-status";

export const placeOrderBody = z.object({
  receiverName: z.string().trim().min(1).max(255),
  receiverAddress: z.string().trim().min(1).max(255),
  receiverPhone: z.string().trim().min(8).max(20),
});
export type PlaceOrderBody = z.infer<typeof placeOrderBody>;

export const idempotencyKeyHeader = z.string().trim().min(1).max(64);

export const adminListOrdersQuery = pageQuery.extend({ status: z.enum(ORDER_STATUSES).optional() });
export type AdminListOrdersQuery = z.infer<typeof adminListOrdersQuery>;

export const updateStatusBody = z.object({ status: z.enum(ORDER_STATUSES) });
export type UpdateStatusBody = z.infer<typeof updateStatusBody>;
