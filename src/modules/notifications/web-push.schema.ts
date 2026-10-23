import { z } from "zod";

export const webPushSubscriptionBody = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z
      .object({ p256dh: z.string().min(1).max(255), auth: z.string().min(1).max(255) })
      .strict(),
    userAgent: z.string().max(255).optional(),
  })
  .strict();

export type WebPushSubscriptionBody = z.infer<typeof webPushSubscriptionBody>;
