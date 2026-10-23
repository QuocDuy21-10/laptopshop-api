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
