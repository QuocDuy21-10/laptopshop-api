import { z } from "zod";

export const salesQuery = z.object({ from: z.string().date(), to: z.string().date() });
export type SalesQuery = z.infer<typeof salesQuery>;
