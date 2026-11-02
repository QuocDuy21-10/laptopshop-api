import { z } from "zod";

import { MAX_DB_INT, pageQuery } from "lib/http";

// IDs and prices are MySQL INT columns: larger values must fail validation, not reach Prisma (HTTP 500)
const dbIdSchema = z.coerce.number().int().positive().max(MAX_DB_INT);

// accept JSON numbers or digit-only strings; z.coerce would turn `true` into 1 and "" into 0
const priceSchema = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value),
  z.number().int().positive().max(MAX_DB_INT),
);

export const wishlistProductParams = z.object({
  productId: dbIdSchema,
});
export type WishlistProductParams = z.infer<typeof wishlistProductParams>;

export const wishlistQuery = pageQuery;
export type WishlistQuery = z.infer<typeof wishlistQuery>;

export const wishlistStatusQuery = z
  .object({
    productIds: z.preprocess(
      (value) => (typeof value === "string" ? value.split(",") : value),
      z.array(dbIdSchema).min(1).max(50),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.productIds).size !== value.productIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productIds"],
        message: "productIds must be unique",
      });
    }
  });
export type WishlistStatusQuery = z.infer<typeof wishlistStatusQuery>;

export const configurePriceAlertBody = z.union([
  z.object({ mode: z.literal("PERCENT_DROP"), includeFlashSale: z.boolean().optional() }).strict(),
  z
    .object({
      mode: z.literal("TARGET_PRICE"),
      targetPrice: priceSchema,
      includeFlashSale: z.boolean().optional(),
    })
    .strict(),
  z.object({ mode: z.literal(null) }).strict(),
]);
export type ConfigurePriceAlertBody = z.infer<typeof configurePriceAlertBody>;
