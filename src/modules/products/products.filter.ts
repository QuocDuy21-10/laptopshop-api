import { Prisma } from "@prisma/client";
import {
  LOW_STOCK_THRESHOLD,
  PRICE_RANGES,
  type ProductFacetKey,
  type PriceRange,
} from "modules/products/products.facets";
import type { AdminListProductsQuery, ProductFilterQuery } from "modules/products/products.schema";

type ProductWhereQuery = ProductFilterQuery &
  Partial<Pick<AdminListProductsQuery, "isActive" | "stock">>;

const screenSizeWhere = (value: string): Prisma.ProductWhereInput => ({
  screenSizeInch:
    value === "compact" ? { lt: 14 } : value === "standard" ? { gte: 14, lt: 16 } : { gte: 16 },
});

export const productWhere = (
  query: ProductWhereQuery,
  options: { admin: boolean; excludeFacet?: ProductFacetKey },
): Prisma.ProductWhereInput => {
  const where: Prisma.ProductWhereInput = {};
  const conditions: Prisma.ProductWhereInput[] = [];
  const excluded = options.excludeFacet;

  if (options.admin) {
    if (query.isActive !== undefined) where.isActive = query.isActive;
  } else {
    where.isActive = true;
  }
  if (query.q) where.name = { contains: query.q };
  if (query.stock === "low") conditions.push({ quantity: { lte: LOW_STOCK_THRESHOLD } });

  if (excluded !== "factory" && query.factory.length)
    conditions.push({ factory: { in: query.factory } });
  if (excluded !== "target" && query.target.length)
    conditions.push({ target: { in: query.target } });
  if (excluded !== "price" && query.price.length) {
    conditions.push({
      OR: query.price.map((range) => ({ price: PRICE_RANGES[range as PriceRange] })),
    });
  }
  if (excluded !== "cpuBrand" && query.cpuBrand.length)
    conditions.push({ cpuBrand: { in: query.cpuBrand } });
  if (excluded !== "gpuBrand" && query.gpuBrand.length)
    conditions.push({ gpuBrand: { in: query.gpuBrand } });
  if (excluded !== "gpuType" && query.gpuType.length)
    conditions.push({ gpuType: { in: query.gpuType } });
  if (excluded !== "ramGb" && query.ramGb.length) conditions.push({ ramGb: { in: query.ramGb } });
  if (excluded !== "storageGb" && query.storageGb.length)
    conditions.push({ storageGb: { in: query.storageGb } });
  if (excluded !== "screenSize" && query.screenSize.length) {
    conditions.push({ OR: query.screenSize.map(screenSizeWhere) });
  }
  if (excluded !== "resolutionTier" && query.resolutionTier.length) {
    conditions.push({ resolutionTier: { in: query.resolutionTier } });
  }
  if (excluded !== "panelType" && query.panelType.length)
    conditions.push({ panelType: { in: query.panelType } });
  if (excluded !== "minRefreshHz" && query.minRefreshHz !== undefined) {
    conditions.push({ refreshRateHz: { gte: query.minRefreshHz } });
  }
  if (excluded !== "minBatteryWh" && query.minBatteryWh !== undefined) {
    conditions.push({ batteryWh: { gte: query.minBatteryWh } });
  }
  if (excluded !== "maxWeightGrams" && query.maxWeightGrams !== undefined) {
    conditions.push({ weightGrams: { lte: query.maxWeightGrams } });
  }
  if (excluded !== "minWarrantyMonths" && query.minWarrantyMonths !== undefined) {
    conditions.push({ warrantyMonths: { gte: query.minWarrantyMonths } });
  }
  if (excluded !== "inStock" && query.inStock === true) conditions.push({ quantity: { gt: 0 } });

  if (conditions.length) where.AND = conditions;
  return where;
};
