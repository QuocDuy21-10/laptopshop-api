import { z } from "zod";
import { idParams, pageQuery } from "lib/http";
import { SERVICE_REQUEST_TYPES } from "modules/after-sales/after-sales.types";

export const deviceEligibilityQuery = pageQuery.extend({
  type: z.enum(SERVICE_REQUEST_TYPES),
});
export type DeviceEligibilityQuery = z.infer<typeof deviceEligibilityQuery>;

const createServiceRequestItem = z.object({
  orderDetailId: z.coerce.number().int().positive(),
  deviceLabel: z.string().trim().min(1).max(100),
  serialNumber: z.string().trim().min(1).max(100).optional(),
  issueDescription: z.string().trim().min(1).max(5000),
});

export const createServiceRequestBody = z
  .object({
    type: z.enum(["WARRANTY", "TECHNICAL_SUPPORT"]),
    subject: z.string().trim().min(1).max(200),
    previousRequestId: z.coerce.number().int().positive().optional(),
    items: z.array(createServiceRequestItem).min(1).max(50),
  })
  .superRefine((value, ctx) => {
    const ids = value.items.map((item) => item.orderDetailId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Each device must be listed once per request",
      });
    }
    const serials = value.items.map((item) => item.serialNumber?.toLowerCase()).filter(Boolean);
    if (new Set(serials).size !== serials.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Device serial numbers must be unique",
      });
    }
  });
export type CreateServiceRequestBody = z.infer<typeof createServiceRequestBody>;

export const serviceRequestQuery = pageQuery;
export type ServiceRequestQuery = z.infer<typeof serviceRequestQuery>;
export const serviceRequestParams = idParams;

export const serviceItemParams = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});
export const serviceAttachmentParams = z.object({
  id: z.coerce.number().int().positive(),
  attachmentId: z.coerce.number().int().positive(),
});

export const transitionItemBody = z.object({
  to: z.enum([
    "SUBMITTED",
    "REVIEWING",
    "APPROVED",
    "AWAITING_ITEM",
    "RECEIVED",
    "DIAGNOSING",
    "AWAITING_QUOTE_DECISION",
    "IN_SERVICE",
    "READY_FOR_RETURN",
    "RETURNED",
    "RESOLVED",
    "CLOSED",
    "REJECTED",
    "CANCELLED",
  ]),
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().max(1000).optional(),
  resolution: z.string().trim().max(5000).optional(),
  closeMode: z.enum(["ADMINISTRATIVE", "TIMEOUT"]).optional(),
});

export const completionDisputeBody = z.object({
  reason: z.enum(["DEVICE_NOT_RECEIVED", "ISSUE_PERSISTS"]),
  note: z.string().trim().min(1).max(2000),
});

export const serviceMessageBody = z.object({
  itemId: z.coerce.number().int().positive().optional(),
  body: z.string().trim().min(1).max(5000),
});

export const adminServiceRequestQuery = pageQuery.extend({
  type: z.enum(["WARRANTY", "TECHNICAL_SUPPORT"]).optional(),
  status: z
    .enum([
      "SUBMITTED",
      "REVIEWING",
      "IN_PROGRESS",
      "AWAITING_CUSTOMER",
      "PARTIALLY_COMPLETED",
      "CLOSED",
    ])
    .optional(),
  itemStatus: z.string().min(1).optional(),
  assigneeId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type AdminServiceRequestQuery = z.infer<typeof adminServiceRequestQuery>;

export const assignServiceRequestBody = z.object({
  assignedToId: z.coerce.number().int().positive().nullable(),
  expectedVersion: z.number().int().positive(),
});

export const quoteParams = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
  quoteId: z.coerce.number().int().positive(),
});
export const sendQuoteBody = z.object({
  expectedVersion: z.number().int().positive(),
  validDays: z.number().int().min(1).max(30).default(7),
  note: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(255),
        quantity: z.number().int().positive(),
        unitPrice: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(50),
});
export type SendQuoteBody = z.infer<typeof sendQuoteBody>;
export const quoteDecisionBody = z.object({ decision: z.enum(["ACCEPT", "DECLINE"]) });
export type QuoteDecisionBody = z.infer<typeof quoteDecisionBody>;
