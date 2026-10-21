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

const day = z.string().date();

export const adminListReviewsQuery = pageQuery.extend({
  productId: z.coerce.number().int().positive().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  status: z.enum(["PUBLISHED", "HIDDEN"]).optional(),
  deleted: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  q: z.string().trim().min(1).max(100).optional(),
  from: day.optional(),
  to: day.optional(),
});

export const moderateReviewBody = z
  .object({
    status: z.enum(["PUBLISHED", "HIDDEN"]),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "HIDDEN" && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Reason is required when hiding a review",
      });
    }
    if (value.status === "PUBLISHED" && value.reason !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Reason is not accepted when publishing a review",
      });
    }
  });

export type AdminListReviewsQuery = z.infer<typeof adminListReviewsQuery>;
export type ModerateReviewBody = z.infer<typeof moderateReviewBody>;
