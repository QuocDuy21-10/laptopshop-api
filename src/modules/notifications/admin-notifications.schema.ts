import { z } from "zod";
import { pageQuery } from "lib/http";

export const notificationDeliveryQuery = pageQuery.extend({
  status: z
    .enum([
      "PENDING",
      "PROCESSING",
      "DELIVERED",
      "RETRYING",
      "FAILED",
      "DEAD",
      "CANCELLED",
      "SUPPRESSED",
    ])
    .optional(),
  channel: z.enum(["EMAIL", "WEB_PUSH"]).optional(),
});
export type NotificationDeliveryQuery = z.infer<typeof notificationDeliveryQuery>;

export const retryNotificationDeliveryBody = z
  .object({ reason: z.string().trim().min(1).max(255) })
  .strict();
