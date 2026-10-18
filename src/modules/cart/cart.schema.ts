import { z } from "zod";

export const addItemBody = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(100),
});
export type AddItemBody = z.infer<typeof addItemBody>;

export const updateItemBody = z.object({ quantity: z.number().int().min(1).max(100) });
export type UpdateItemBody = z.infer<typeof updateItemBody>;
