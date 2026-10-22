import { z } from "zod";
import { idParams, pageQuery } from "lib/http";

export const PROMOTION_KINDS = ["COUPON", "AUTOMATIC", "FLASH_SALE"] as const;
export const PROMOTION_STATES = ["DRAFT", "ACTIVE", "PAUSED", "ENDED"] as const;
export const DISCOUNT_KINDS = ["PERCENT", "FIXED"] as const;
export const COUPON_SCOPES = ["ORDER", "PRODUCT"] as const;
export const PROMOTION_ACTIONS = ["ACTIVATE", "PAUSE", "RESUME", "END"] as const;

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(50)
  .regex(/^[A-Z0-9_-]+$/, "Coupon code must use A-Z, 0-9, _ or -");

const targetIds = z.array(z.coerce.number().int().positive()).max(500).default([]);
const couponPolicy = z
  .object({
    code,
    scope: z.enum(COUPON_SCOPES),
    minOrderValue: z.coerce.number().int().min(0).default(0),
    maxDiscount: z.coerce.number().int().positive().nullable().optional(),
    maxUses: z.coerce.number().int().positive().nullable().optional(),
    maxUsesPerUser: z.coerce.number().int().positive().default(1),
    isPublic: z.boolean().default(false),
    targetProductIds: targetIds,
  })
  .strict();

const automaticPolicy = z
  .object({
    priority: z.coerce.number().int().min(-1_000_000).max(1_000_000).default(0),
    stackableWithCoupon: z.boolean().default(false),
    targetProductIds: targetIds,
  })
  .strict();

const flashSaleItem = z
  .object({
    productId: z.coerce.number().int().positive(),
    totalQuota: z.coerce.number().int().positive(),
    maxUnitsPerUser: z.coerce.number().int().positive(),
  })
  .strict();

const flashSalePolicyBase = z
  .object({
    priority: z.coerce.number().int().min(-1_000_000).max(1_000_000).default(0),
    stackableWithCoupon: z.boolean().default(false),
    showRemainingQuota: z.boolean().default(true),
    items: z.array(flashSaleItem).min(1).max(500),
  })
  .strict();

const flashSalePolicy = flashSalePolicyBase.superRefine((value, ctx) => {
  const seen = new Set<number>();
  value.items.forEach((item, index) => {
    if (seen.has(item.productId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "productId"],
        message: "Flash Sale products must be unique",
      });
    }
    seen.add(item.productId);
    if (item.maxUnitsPerUser > item.totalQuota) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "maxUnitsPerUser"],
        message: "maxUnitsPerUser cannot exceed totalQuota",
      });
    }
  });
});

const promotionBase = z
  .object({
    kind: z.enum(PROMOTION_KINDS),
    name: z.string().trim().min(1).max(150),
    description: optionalText(500),
    discountKind: z.enum(DISCOUNT_KINDS),
    discountValue: z.coerce.number().int().positive(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    coupon: couponPolicy.optional(),
    automatic: automaticPolicy.optional(),
    flashSale: flashSalePolicy.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startsAt >= value.endsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endsAt"],
        message: "endsAt must be after startsAt",
      });
    }
    if (value.discountKind === "PERCENT" && value.discountValue > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        path: ["discountValue"],
        maximum: 100,
        type: "number",
        inclusive: true,
        message: "Percent must be at most 100",
      });
    }
    if (value.kind === "COUPON") {
      if (!value.coupon || value.automatic) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coupon"],
          message: "Coupon policy is required",
        });
      }
      if (value.coupon?.scope === "ORDER" && value.coupon.targetProductIds.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coupon", "targetProductIds"],
          message: "Order coupon cannot target products",
        });
      }
      if (value.coupon?.scope === "PRODUCT" && value.coupon.targetProductIds.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coupon", "targetProductIds"],
          message: "Product coupon needs targets",
        });
      }
      if (value.discountKind === "FIXED" && value.coupon?.maxDiscount != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coupon", "maxDiscount"],
          message: "Fixed coupon cannot use maxDiscount",
        });
      }
    }
    if (value.kind === "AUTOMATIC") {
      if (!value.automatic || value.coupon) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["automatic"],
          message: "Automatic policy is required",
        });
      }
      if (value.automatic?.targetProductIds.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["automatic", "targetProductIds"],
          message: "Automatic promotion needs targets",
        });
      }
    }
    if (value.kind === "FLASH_SALE") {
      if (!value.flashSale || value.coupon || value.automatic) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flashSale"],
          message: "Flash Sale policy is required and cannot mix coupon or automatic policy",
        });
      }
    } else if (value.flashSale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["flashSale"],
        message: "Flash Sale policy is only valid for FLASH_SALE promotions",
      });
    }
  });

export const createPromotionBody = promotionBase;
export type CreatePromotionBody = z.infer<typeof createPromotionBody>;

export const updatePromotionBody = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    description: optionalText(500),
    discountKind: z.enum(DISCOUNT_KINDS).optional(),
    discountValue: z.coerce.number().int().positive().optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    coupon: couponPolicy.partial().optional(),
    automatic: automaticPolicy.partial().optional(),
    flashSale: flashSalePolicyBase
      .partial()
      .extend({ items: z.array(flashSaleItem).max(500).optional() })
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
export type UpdatePromotionBody = z.infer<typeof updatePromotionBody>;

export const transitionPromotionBody = z.object({ action: z.enum(PROMOTION_ACTIONS) });
export type TransitionPromotionBody = z.infer<typeof transitionPromotionBody>;

export const promotionIdParams = idParams;
export type PromotionIdParams = z.infer<typeof promotionIdParams>;

export const adminPromotionQuery = pageQuery.extend({
  kind: z.enum(PROMOTION_KINDS).optional(),
  state: z.enum(PROMOTION_STATES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type AdminPromotionQuery = z.infer<typeof adminPromotionQuery>;

export const promotionRedemptionQuery = pageQuery;
export type PromotionRedemptionQuery = z.infer<typeof promotionRedemptionQuery>;

export const flashSaleAvailabilityQuery = z
  .object({
    productIds: z.preprocess(
      (value) => (typeof value === "string" ? value.split(",") : value),
      z.array(z.coerce.number().int().positive()).min(1).max(20),
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
export type FlashSaleAvailabilityQuery = z.infer<typeof flashSaleAvailabilityQuery>;
