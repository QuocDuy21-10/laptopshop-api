import { z } from "zod";
import { pageQuery } from "lib/http";

export const paymentProviderParam = z.object({ provider: z.enum(["fake", "sepay"]) });
export const paymentEventIdParams = z.object({ id: z.string().uuid() });
export const paymentEventQuery = pageQuery.extend({
  status: z.enum(["MATCHED", "REVIEW_REQUIRED", "RESOLVED"]).optional(),
  reason: z.string().trim().min(1).max(40).optional(),
});
export const resolvePaymentEventBody = z.object({ note: z.string().trim().min(1).max(500) });
export type PaymentEventQuery = z.infer<typeof paymentEventQuery>;
