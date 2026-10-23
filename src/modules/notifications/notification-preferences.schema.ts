import { z } from "zod";

export const updateNotificationPreferencesBody = z
  .object({
    emailEnabled: z.boolean().optional(),
    webPushEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.emailEnabled !== undefined || value.webPushEnabled !== undefined, {
    message: "At least one preference is required",
  });

export type UpdateNotificationPreferencesBody = z.infer<typeof updateNotificationPreferencesBody>;
