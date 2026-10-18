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
});
export type ListProductsQuery = z.infer<typeof listProductsQuery>;
