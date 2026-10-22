import { z } from "zod";
import { pageQuery } from "lib/http";
import { ORDER_STATUSES } from "modules/orders/order-status";

export const placeOrderBody = z.object({
  receiverName: z.string().trim().min(1).max(255),
  receiverAddress: z.string().trim().min(1).max(255),
  receiverPhone: z.string().trim().min(8).max(20),
  paymentMethod: z.enum(["COD", "BANK_TRANSFER"]).default("COD"),
  couponCode: z.string().trim().min(1).max(50).optional(),
  pricingFingerprint: z.string().trim().length(64),
});
export type PlaceOrderBody = z.infer<typeof placeOrderBody>;

export const quoteOrderBody = z.object({ couponCode: z.string().trim().min(1).max(50).optional() });
export type QuoteOrderBody = z.infer<typeof quoteOrderBody>;

export { idempotencyKeyHeader } from "lib/idempotency";

// YYYY-MM-DD with a real calendar check (2026-02-30 is rejected)
const day = z.string().date();

export const adminListOrdersQuery = pageQuery.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: day.optional(),
  to: day.optional(),
  userId: z.coerce.number().int().positive().optional(),
});
export type AdminListOrdersQuery = z.infer<typeof adminListOrdersQuery>;

export const updateStatusBody = z.object({ status: z.enum(ORDER_STATUSES) });
export type UpdateStatusBody = z.infer<typeof updateStatusBody>;

export const adminExportOrdersQuery = adminListOrdersQuery.omit({ page: true, pageSize: true });
export type AdminExportOrdersQuery = z.infer<typeof adminExportOrdersQuery>;
