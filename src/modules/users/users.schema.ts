import { z } from "zod";

export const updateMeBody = z.object({
  fullName: z.string().trim().min(1).max(255).optional(),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(255).optional(),
});
export type UpdateMeBody = z.infer<typeof updateMeBody>;
