import { z } from "zod";
import { pageQuery } from "lib/http";

export const listProductReviewsQuery = pageQuery.extend({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  sort: z.enum(["newest", "highest", "lowest"]).default("newest"),
});

export type ListProductReviewsQuery = z.infer<typeof listProductReviewsQuery>;
