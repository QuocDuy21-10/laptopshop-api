import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import {
  BATTERY_MINIMUMS,
  PRICE_RANGES,
  REFRESH_RATE_MINIMUMS,
  WARRANTY_MINIMUMS,
  WEIGHT_MAXIMUMS,
  type ProductFacetKey,
} from "modules/products/products.facets";
import type { ProductFilterQuery } from "modules/products/products.schema";

export type FacetAggregateRow = { facetKey: string; value: string; count: bigint };

const andWhere = (conditions: Prisma.Sql[]) =>
  conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;

const inList = (column: Prisma.Sql, values: readonly (string | number)[]) =>
  Prisma.sql`${column} IN (${Prisma.join(values)})`;

const pricePredicate = (column: Prisma.Sql, values: readonly string[]) =>
  Prisma.sql`(${Prisma.join(
    values.map((value) => {
      const range = PRICE_RANGES[value as keyof typeof PRICE_RANGES];
      if ("lt" in range && !("gte" in range)) return Prisma.sql`${column} < ${range.lt}`;
      if ("gt" in range) return Prisma.sql`${column} > ${range.gt}`;
      if ("lt" in range) return Prisma.sql`${column} >= ${range.gte} AND ${column} < ${range.lt}`;
      return Prisma.sql`${column} >= ${range.gte} AND ${column} <= ${range.lte}`;
    }),
    " OR ",
  )})`;

const screenSizePredicate = (column: Prisma.Sql, values: readonly string[]) =>
  Prisma.sql`(${Prisma.join(
    values.map((value) =>
      value === "compact"
        ? Prisma.sql`${column} < 14`
        : value === "standard"
          ? Prisma.sql`${column} >= 14 AND ${column} < 16`
          : Prisma.sql`${column} >= 16`,
    ),
    " OR ",
  )})`;

const filterConditions = (query: ProductFilterQuery, exclude?: ProductFacetKey): Prisma.Sql[] => {
  const conditions: Prisma.Sql[] = [];
  const col = (name: string) => Prisma.raw(`b.${name}`);
  if (exclude !== "factory" && query.factory.length)
    conditions.push(inList(col("factory"), query.factory));
  if (exclude !== "target" && query.target.length)
    conditions.push(inList(col("target"), query.target));
  if (exclude !== "price" && query.price.length)
    conditions.push(pricePredicate(col("price"), query.price));
  if (exclude !== "cpuBrand" && query.cpuBrand.length)
    conditions.push(inList(col("cpuBrand"), query.cpuBrand));
  if (exclude !== "gpuBrand" && query.gpuBrand.length)
    conditions.push(inList(col("gpuBrand"), query.gpuBrand));
  if (exclude !== "gpuType" && query.gpuType.length)
    conditions.push(inList(col("gpuType"), query.gpuType));
  if (exclude !== "ramGb" && query.ramGb.length) conditions.push(inList(col("ramGb"), query.ramGb));
  if (exclude !== "storageGb" && query.storageGb.length)
    conditions.push(inList(col("storageGb"), query.storageGb));
  if (exclude !== "screenSize" && query.screenSize.length)
    conditions.push(screenSizePredicate(col("screenSizeInch"), query.screenSize));
  if (exclude !== "resolutionTier" && query.resolutionTier.length)
    conditions.push(inList(col("resolutionTier"), query.resolutionTier));
  if (exclude !== "panelType" && query.panelType.length)
    conditions.push(inList(col("panelType"), query.panelType));
  if (exclude !== "minRefreshHz" && query.minRefreshHz !== undefined)
    conditions.push(Prisma.sql`${col("refreshRateHz")} >= ${query.minRefreshHz}`);
  if (exclude !== "minBatteryWh" && query.minBatteryWh !== undefined)
    conditions.push(Prisma.sql`${col("batteryWh")} >= ${query.minBatteryWh}`);
  if (exclude !== "maxWeightGrams" && query.maxWeightGrams !== undefined)
    conditions.push(Prisma.sql`${col("weightGrams")} <= ${query.maxWeightGrams}`);
  if (exclude !== "minWarrantyMonths" && query.minWarrantyMonths !== undefined)
    conditions.push(Prisma.sql`${col("warrantyMonths")} >= ${query.minWarrantyMonths}`);
  if (exclude !== "inStock" && query.inStock === true)
    conditions.push(Prisma.sql`${col("quantity")} > 0`);
  return conditions;
};

const groupedBranch = (
  key: ProductFacetKey,
  expression: Prisma.Sql,
  notNull: Prisma.Sql,
  query: ProductFilterQuery,
) => {
  const valueExpression = Prisma.sql`CAST(${expression} AS CHAR)`;
  return Prisma.sql`
  SELECT ${key} AS facetKey, ${valueExpression} AS value, COUNT(*) AS count
  FROM base b
  ${andWhere([...filterConditions(query, key), notNull])}
  GROUP BY ${valueExpression}
`;
};

const thresholdBranch = (
  key: ProductFacetKey,
  column: string,
  operator: ">=" | "<=",
  values: readonly number[],
  query: ProductFilterQuery,
) =>
  values.map(
    (value) => Prisma.sql`
    SELECT ${key} AS facetKey, ${String(value)} AS value, COUNT(*) AS count
    FROM base b
    ${andWhere([...filterConditions(query, key), Prisma.sql`${Prisma.raw(`b.${column}`)} ${Prisma.raw(operator)} ${value}`])}
  `,
  );

const totalBranch = (query: ProductFilterQuery) => Prisma.sql`
  SELECT '__total__' AS facetKey, '__total__' AS value, COUNT(*) AS count
  FROM base b
  ${andWhere(filterConditions(query))}
`;

export const queryProductFacetRows = async (
  query: ProductFilterQuery,
): Promise<FacetAggregateRow[]> => {
  const baseWhere = query.q
    ? Prisma.sql`WHERE p.isActive = 1 AND p.name LIKE ${`%${query.q}%`}`
    : Prisma.sql`WHERE p.isActive = 1`;
  const priceExpression = Prisma.sql`CASE WHEN b.price < 10000000 THEN 'under-10m' WHEN b.price < 15000000 THEN '10-15m' WHEN b.price <= 20000000 THEN '15-20m' WHEN b.price > 20000000 THEN 'over-20m' END`;
  const screenExpression = Prisma.sql`CASE WHEN b.screenSizeInch < 14 THEN 'compact' WHEN b.screenSizeInch < 16 THEN 'standard' WHEN b.screenSizeInch >= 16 THEN 'large' END`;
  const branches: Prisma.Sql[] = [
    totalBranch(query),
    groupedBranch("factory", Prisma.raw("b.factory"), Prisma.sql`b.factory IS NOT NULL`, query),
    groupedBranch("target", Prisma.raw("b.target"), Prisma.sql`b.target IS NOT NULL`, query),
    groupedBranch("price", priceExpression, Prisma.sql`b.price IS NOT NULL`, query),
    groupedBranch("cpuBrand", Prisma.raw("b.cpuBrand"), Prisma.sql`b.cpuBrand IS NOT NULL`, query),
    groupedBranch("gpuBrand", Prisma.raw("b.gpuBrand"), Prisma.sql`b.gpuBrand IS NOT NULL`, query),
    groupedBranch("gpuType", Prisma.raw("b.gpuType"), Prisma.sql`b.gpuType IS NOT NULL`, query),
    groupedBranch("ramGb", Prisma.raw("b.ramGb"), Prisma.sql`b.ramGb IS NOT NULL`, query),
    groupedBranch(
      "storageGb",
      Prisma.raw("b.storageGb"),
      Prisma.sql`b.storageGb IS NOT NULL`,
      query,
    ),
    groupedBranch("screenSize", screenExpression, Prisma.sql`b.screenSizeInch IS NOT NULL`, query),
    groupedBranch(
      "resolutionTier",
      Prisma.raw("b.resolutionTier"),
      Prisma.sql`b.resolutionTier IS NOT NULL`,
      query,
    ),
    groupedBranch(
      "panelType",
      Prisma.raw("b.panelType"),
      Prisma.sql`b.panelType IS NOT NULL`,
      query,
    ),
    ...thresholdBranch("minRefreshHz", "refreshRateHz", ">=", REFRESH_RATE_MINIMUMS, query),
    ...thresholdBranch("minBatteryWh", "batteryWh", ">=", BATTERY_MINIMUMS, query),
    ...thresholdBranch("maxWeightGrams", "weightGrams", "<=", WEIGHT_MAXIMUMS, query),
    ...thresholdBranch("minWarrantyMonths", "warrantyMonths", ">=", WARRANTY_MINIMUMS, query),
    ...thresholdBranch("inStock", "quantity", ">=", [1], query),
  ];
  return prisma.$queryRaw<FacetAggregateRow[]>(Prisma.sql`
    WITH base AS (SELECT p.* FROM products p ${baseWhere})
    ${Prisma.join(branches, " UNION ALL ")}
  `);
};
