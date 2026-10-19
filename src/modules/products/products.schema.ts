import { z } from "zod";
import { factoryOptions, targetOptions } from "config/constant";
import { pageQuery } from "lib/http";

export const PRICE_RANGES = {
  "under-10m": { lt: 10_000_000 },
  "10-15m": { gte: 10_000_000, lte: 15_000_000 },
  "15-20m": { gte: 15_000_000, lte: 20_000_000 },
  "over-20m": { gt: 20_000_000 },
} as const;
export type PriceRange = keyof typeof PRICE_RANGES;

export const FACTORIES = factoryOptions.map((o) => o.value);
export const TARGETS = targetOptions.map((o) => o.value);

export const LOW_STOCK_THRESHOLD = 5;

// multipart and query strings arrive as "true"/"false"; z.coerce.boolean would turn "false" into true
const flag = z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]);

// multipart sends "" for a cleared field; z.coerce.number would turn it into 0
const blankToNull = (v: unknown) => (v === "" ? null : v);
const specText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().min(1).max(max).nullable()).optional();
const specNumber = (min: number, max: number, int = true) =>
  z
    .preprocess(
      blankToNull,
      (int ? z.coerce.number().int() : z.coerce.number()).min(min).max(max).nullable(),
    )
    .optional();

const csvOf = (allowed: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : [],
    )
    .refine((list) => list.every((v) => allowed.includes(v)), {
      message: `Allowed values: ${allowed.join(", ")}`,
    });

export const listProductsQuery = pageQuery.extend({
  factory: csvOf(FACTORIES),
  target: csvOf(TARGETS),
  price: csvOf(Object.keys(PRICE_RANGES)),
  sort: z.enum(["price_asc", "price_desc"]).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuery>;

export const adminListProductsQuery = listProductsQuery.extend({
  isActive: flag.optional(),
  stock: z.enum(["low"]).optional(),
});
export type AdminListProductsQuery = z.infer<typeof adminListProductsQuery>;

export const productBody = z.object({
  name: z.string().trim().min(1).max(255),
  price: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(0),
  shortDesc: z.string().trim().min(1).max(255),
  detailDesc: z.string().trim().min(1),
  factory: z.string().refine((v) => FACTORIES.includes(v), { message: "Unknown factory" }),
  target: z.string().refine((v) => TARGETS.includes(v), { message: "Unknown target" }),
  cpu: specText(255),
  gpu: specText(255),
  ramGb: specNumber(1, 256),
  storageGb: specNumber(1, 16384),
  screenSizeInch: specNumber(10, 20, false),
  screenResolution: specText(50),
  refreshRateHz: specNumber(30, 500),
  batteryWh: specNumber(1, 200),
  weightGrams: specNumber(300, 10000),
  warrantyMonths: specNumber(0, 120),
});
export type ProductBody = z.infer<typeof productBody>;

// stock only changes through inventory adjustments, so the edit endpoint drops quantity
export const productPatchBody = productBody
  .omit({ quantity: true })
  .partial()
  .extend({ isActive: flag.optional() });
export type ProductPatchBody = z.infer<typeof productPatchBody>;

// ids are capped at 9 digits so they always fit the INT primary key
export const compareQuery = z.object({
  ids: z
    .string()
    .regex(/^\s*[1-9]\d{0,8}\s*(,\s*[1-9]\d{0,8}\s*)*$/, "Comma-separated product ids")
    .transform((s) => s.split(",").map(Number))
    .refine((ids) => ids.length >= 2 && ids.length <= 4, { message: "Compare 2 to 4 products" })
    .refine((ids) => new Set(ids).size === ids.length, { message: "Duplicate product ids" }),
});
export type CompareQuery = z.infer<typeof compareQuery>;
