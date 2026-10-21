import { z } from "zod";
import { pageQuery } from "lib/http";
import { idParams } from "lib/http";

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

const helpfulReviewIds = z.preprocess(
  (value) => (Array.isArray(value) ? value.join(",") : value),
  z.string().transform((value, ctx) => {
    const ids = value
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isInteger(item));
    if (!value.trim() || ids.length !== value.split(",").length || ids.some((id) => id <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reviewIds must be positive integers" });
      return z.NEVER;
    }
    const unique = [...new Set(ids)];
    if (unique.length > 50) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At most 50 review IDs are allowed" });
      return z.NEVER;
    }
    return unique;
  }),
);

export const helpfulReviewIdsQuery = z.object({ reviewIds: helpfulReviewIds });
export type HelpfulReviewIdsQuery = z.infer<typeof helpfulReviewIdsQuery>;

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

export const putReviewReplyBody = z
  .object({ content: z.string().trim().min(1).max(1000) })
  .strict();
export type PutReviewReplyBody = z.infer<typeof putReviewReplyBody>;

export const reviewImageParams = idParams.extend({});
export const reviewImageDeleteParams = idParams.extend({
  imageId: z.coerce.number().int().positive(),
});
export const reviewImageOrderBody = z
  .object({
    imageIds: z.array(z.number().int().positive()).max(3),
  })
  .strict();
export type ReviewImageOrderBody = z.infer<typeof reviewImageOrderBody>;
