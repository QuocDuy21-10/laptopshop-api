import { z } from "zod";
import { pageQuery } from "lib/http";

export const STOCK_REASON = {
  OPENING: "OPENING",
  INITIAL: "INITIAL",
  ORDER: "ORDER",
  ORDER_CANCEL: "ORDER_CANCEL",
  RESTOCK: "RESTOCK",
  CORRECTION: "CORRECTION",
} as const;
export type StockReason = keyof typeof STOCK_REASON;
export const STOCK_REASONS = Object.values(STOCK_REASON) as [StockReason, ...StockReason[]];

export const adjustmentBody = z.object({
  productId: z.coerce.number().int().positive(),
  delta: z.coerce
    .number()
    .int()
    .min(-10_000)
    .max(10_000)
    .refine((d) => d !== 0, { message: "must not be 0" }),
  reason: z.enum([STOCK_REASON.RESTOCK, STOCK_REASON.CORRECTION]),
  note: z.string().trim().max(500).optional(),
});
export type AdjustmentBody = z.infer<typeof adjustmentBody>;

export const listMovementsQuery = pageQuery.extend({
  productId: z.coerce.number().int().positive().optional(),
  reason: z.enum(STOCK_REASONS).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type ListMovementsQuery = z.infer<typeof listMovementsQuery>;
