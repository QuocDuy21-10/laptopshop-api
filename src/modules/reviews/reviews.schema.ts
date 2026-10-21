import { z } from "zod";
import { pageQuery } from "lib/http";

export const listProductReviewsQuery = pageQuery.extend({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  sort: z.enum(["newest", "highest", "lowest"]).default("newest"),
});

export type ListProductReviewsQuery = z.infer<typeof listProductReviewsQuery>;

export const createReviewBody = z
  .object({
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().max(150).optional(),
    content: z.string().trim().min(10).max(1500),
    isAnonymous: z.boolean(),
  })
  .strict();

export const updateReviewBody = createReviewBody
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one review field is required");

export type CreateReviewBody = z.infer<typeof createReviewBody>;
export type UpdateReviewBody = z.infer<typeof updateReviewBody>;
