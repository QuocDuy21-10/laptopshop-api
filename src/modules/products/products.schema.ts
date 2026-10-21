import { z } from "zod";
import { pageQuery } from "lib/http";
import {
  BATTERY_MINIMUMS,
  CPU_BRANDS,
  FACTORIES,
  GPU_BRANDS,
  GPU_TYPES,
  PANEL_TYPES,
  PRICE_RANGES,
  REFRESH_RATE_MINIMUMS,
  RESOLUTION_TIERS,
  SCREEN_SIZES,
  TARGETS,
  WARRANTY_MINIMUMS,
  WEIGHT_MAXIMUMS,
} from "modules/products/products.facets";

export {
  FACTORIES,
  LOW_STOCK_THRESHOLD,
  PRICE_RANGES,
  TARGETS,
} from "modules/products/products.facets";
export type { PriceRange } from "modules/products/products.facets";

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
const specEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToNull, z.enum(values).nullable()).optional();

const csvOf = (allowed: readonly string[], maxItems = 10) =>
  z
    .string()
    .optional()
    .transform((s) =>
      s
        ? [
            ...new Set(
              s
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            ),
          ]
        : [],
    )
    .refine((list) => list.length <= maxItems, { message: `At most ${maxItems} values` })
    .refine((list) => list.every((v) => allowed.includes(v)), {
      message: `Allowed values: ${allowed.join(", ")}`,
    });

const csvNumbers = (min: number, max: number, maxItems = 10) =>
  z
    .string()
    .optional()
    .transform((s) => {
      const values = s
        ? s
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : [];
      return [...new Set(values)].map(Number);
    })
    .refine((list) => list.length <= maxItems, { message: `At most ${maxItems} values` })
    .refine((list) => list.every((v) => Number.isInteger(v) && v >= min && v <= max), {
      message: `Values must be integers from ${min} to ${max}`,
    });

const threshold = <T extends readonly number[]>(values: T) =>
  z.coerce
    .number()
    .int()
    .refine((value) => values.includes(value), { message: `Allowed values: ${values.join(", ")}` });

export const productFilterFields = {
  factory: csvOf(FACTORIES),
  target: csvOf(TARGETS),
  price: csvOf(Object.keys(PRICE_RANGES)),
  cpuBrand: csvOf(CPU_BRANDS),
  gpuBrand: csvOf(GPU_BRANDS),
  gpuType: csvOf(GPU_TYPES),
  ramGb: csvNumbers(1, 256),
  storageGb: csvNumbers(1, 16_384),
  screenSize: csvOf(SCREEN_SIZES),
  resolutionTier: csvOf(RESOLUTION_TIERS),
  panelType: csvOf(PANEL_TYPES),
  minRefreshHz: threshold(REFRESH_RATE_MINIMUMS).optional(),
  minBatteryWh: threshold(BATTERY_MINIMUMS).optional(),
  maxWeightGrams: threshold(WEIGHT_MAXIMUMS).optional(),
  minWarrantyMonths: threshold(WARRANTY_MINIMUMS).optional(),
  inStock: flag.optional(),
  q: z.string().trim().min(1).max(100).optional(),
};

export const productFacetsQuery = z.object(productFilterFields);
export type ProductFilterQuery = z.infer<typeof productFacetsQuery>;

export const listProductsQuery = pageQuery.extend({
  ...productFilterFields,
  sort: z.enum(["price_asc", "price_desc"]).optional(),
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
  cpuBrand: specEnum(CPU_BRANDS),
  gpu: specText(255),
  gpuBrand: specEnum(GPU_BRANDS),
  gpuType: specEnum(GPU_TYPES),
  ramGb: specNumber(1, 256),
  storageGb: specNumber(1, 16384),
  screenSizeInch: specNumber(10, 20, false),
  screenResolution: specText(50),
  panelType: specEnum(PANEL_TYPES),
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

export const adminExportProductsQuery = adminListProductsQuery.omit({ page: true, pageSize: true });
export type AdminExportProductsQuery = z.infer<typeof adminExportProductsQuery>;
