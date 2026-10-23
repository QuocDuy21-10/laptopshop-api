import { z } from "zod";

export const confirmEmailVerificationBody = z
  .object({ code: z.string().regex(/^\d{6}$/) })
  .strict();
export type ConfirmEmailVerificationBody = z.infer<typeof confirmEmailVerificationBody>;
