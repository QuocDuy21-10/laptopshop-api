import { z } from "zod";
import { pageQuery } from "lib/http";

export const wishlistProductParams = z.object({
  productId: z.coerce.number().int().positive(),
});
export type WishlistProductParams = z.infer<typeof wishlistProductParams>;

export const wishlistQuery = pageQuery;
export type WishlistQuery = z.infer<typeof wishlistQuery>;

export const wishlistStatusQuery = z
  .object({
    productIds: z.preprocess(
      (value) => (typeof value === "string" ? value.split(",") : value),
      z.array(z.coerce.number().int().positive()).min(1).max(50),
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
  z.object({ mode: z.literal("PERCENT_DROP") }).strict(),
  z
    .object({ mode: z.literal("TARGET_PRICE"), targetPrice: z.coerce.number().int().positive() })
    .strict(),
  z.object({ mode: z.literal(null) }).strict(),
]);
export type ConfigurePriceAlertBody = z.infer<typeof configurePriceAlertBody>;
