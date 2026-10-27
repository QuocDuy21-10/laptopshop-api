import { Prisma } from "@prisma/client";
import { PRICE_RANGES, type ProductFacetKey } from "modules/products/products.facets";
import type { ProductFilterQuery } from "modules/products/products.schema";

const columnNames = {
  factory: "factory",
  target: "target",
  price: "price",
  cpuBrand: "cpuBrand",
  gpuBrand: "gpuBrand",
  gpuType: "gpuType",
  ramGb: "ramGb",
  storageGb: "storageGb",
  screenSizeInch: "screenSizeInch",
  resolutionTier: "resolutionTier",
  panelType: "panelType",
  refreshRateHz: "refreshRateHz",
  batteryWh: "batteryWh",
  weightGrams: "weightGrams",
  warrantyMonths: "warrantyMonths",
  quantity: "quantity",
} as const;

type CatalogColumn = keyof typeof columnNames;

export type CatalogFilterOptions = {
  priceExpression?: Prisma.Sql;
};

const column = (alias: string, name: CatalogColumn) => Prisma.raw(`${alias}.${columnNames[name]}`);

const inList = (field: Prisma.Sql, values: readonly (string | number)[]) =>
  Prisma.sql`${field} IN (${Prisma.join(values)})`;

const pricePredicate = (field: Prisma.Sql, values: readonly string[]) =>
  Prisma.sql`(${Prisma.join(
    values.map((value) => {
      const range = PRICE_RANGES[value as keyof typeof PRICE_RANGES];
      if ("lt" in range && !("gte" in range)) return Prisma.sql`${field} < ${range.lt}`;
      if ("gt" in range) return Prisma.sql`${field} > ${range.gt}`;
      if ("lt" in range) return Prisma.sql`${field} >= ${range.gte} AND ${field} < ${range.lt}`;
      return Prisma.sql`${field} >= ${range.gte} AND ${field} <= ${range.lte}`;
    }),
    " OR ",
  )})`;

const screenSizePredicate = (field: Prisma.Sql, values: readonly string[]) =>
  Prisma.sql`(${Prisma.join(
    values.map((value) =>
      value === "compact"
        ? Prisma.sql`${field} < 14`
        : value === "standard"
          ? Prisma.sql`${field} >= 14 AND ${field} < 16`
          : Prisma.sql`${field} >= 16`,
    ),
    " OR ",
  )})`;

export const catalogFilterConditions = (
  query: ProductFilterQuery,
  alias = "p",
  exclude?: ProductFacetKey,
  options: CatalogFilterOptions = {},
): Prisma.Sql[] => {
  const conditions: Prisma.Sql[] = [Prisma.sql`${Prisma.raw(`${alias}.isActive`)} = 1`];
  const addIn = (
    key: ProductFacetKey,
    field: CatalogColumn,
    values: readonly (string | number)[],
  ) => {
    if (exclude !== key && values.length) conditions.push(inList(column(alias, field), values));
  };
  addIn("factory", "factory", query.factory);
  addIn("target", "target", query.target);
  if (exclude !== "price" && query.price.length)
    conditions.push(pricePredicate(options.priceExpression ?? column(alias, "price"), query.price));
  addIn("cpuBrand", "cpuBrand", query.cpuBrand);
  addIn("gpuBrand", "gpuBrand", query.gpuBrand);
  addIn("gpuType", "gpuType", query.gpuType);
  addIn("ramGb", "ramGb", query.ramGb);
  addIn("storageGb", "storageGb", query.storageGb);
  if (exclude !== "screenSize" && query.screenSize.length)
    conditions.push(screenSizePredicate(column(alias, "screenSizeInch"), query.screenSize));
  addIn("resolutionTier", "resolutionTier", query.resolutionTier);
  addIn("panelType", "panelType", query.panelType);
  if (exclude !== "minRefreshHz" && query.minRefreshHz !== undefined)
    conditions.push(Prisma.sql`${column(alias, "refreshRateHz")} >= ${query.minRefreshHz}`);
  if (exclude !== "minBatteryWh" && query.minBatteryWh !== undefined)
    conditions.push(Prisma.sql`${column(alias, "batteryWh")} >= ${query.minBatteryWh}`);
  if (exclude !== "maxWeightGrams" && query.maxWeightGrams !== undefined)
    conditions.push(Prisma.sql`${column(alias, "weightGrams")} <= ${query.maxWeightGrams}`);
  if (exclude !== "minWarrantyMonths" && query.minWarrantyMonths !== undefined)
    conditions.push(Prisma.sql`${column(alias, "warrantyMonths")} >= ${query.minWarrantyMonths}`);
  if (exclude !== "inStock" && query.inStock === true)
    conditions.push(Prisma.sql`${column(alias, "quantity")} > 0`);
  if (query.q) conditions.push(Prisma.sql`${Prisma.raw(`${alias}.name`)} LIKE ${`%${query.q}%`}`);
  return conditions;
};

export const andSql = (conditions: Prisma.Sql[]) =>
  conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
