import { z } from "zod";
import { pageQuery } from "lib/http";

export const paymentProviderParam = z.object({ provider: z.enum(["fake", "sepay"]) });
export const paymentEventIdParams = z.object({ id: z.string().uuid() });
export type PaymentEventIdParams = z.infer<typeof paymentEventIdParams>;
export const paymentEventQuery = pageQuery.extend({
  status: z.enum(["MATCHED", "REVIEW_REQUIRED", "RESOLVED"]).optional(),
  reason: z.string().trim().min(1).max(40).optional(),
});
export const resolvePaymentEventBody = z.object({ note: z.string().trim().min(1).max(500) });
export type PaymentEventQuery = z.infer<typeof paymentEventQuery>;

export const paymentReviewCaseIdParams = z.object({ id: z.string().uuid() });
export type PaymentReviewCaseIdParams = z.infer<typeof paymentReviewCaseIdParams>;
export const paymentReviewCaseQuery = pageQuery.extend({
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
});
export const extendPaymentReviewCaseBody = z.object({
  note: z.string().trim().min(1).max(500),
  holdUntil: z.string().datetime(),
  version: z.number().int().nonnegative(),
});
export const releasePaymentReviewCaseBody = z.object({
  note: z.string().trim().min(1).max(500),
  confirmation: z.literal("RELEASE_STOCK"),
  version: z.number().int().nonnegative(),
});
export type PaymentReviewCaseQuery = z.infer<typeof paymentReviewCaseQuery>;
