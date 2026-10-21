import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import {
  BATTERY_MINIMUMS,
  REFRESH_RATE_MINIMUMS,
  WARRANTY_MINIMUMS,
  WEIGHT_MAXIMUMS,
  type ProductFacetKey,
} from "modules/products/products.facets";
import { andSql, catalogFilterConditions } from "modules/products/products.catalog-sql";
import type { ProductFilterQuery } from "modules/products/products.schema";

export type FacetAggregateRow = { facetKey: string; value: string; count: bigint };

const filterConditions = (query: ProductFilterQuery, exclude?: ProductFacetKey): Prisma.Sql[] => {
  const conditions = catalogFilterConditions(query, "b", exclude);
  if (exclude !== "minRating" && query.minRating !== undefined)
    conditions.push(Prisma.sql`b.averageRating >= ${query.minRating}`);
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
  ${andSql([...filterConditions(query, key), notNull])}
  GROUP BY ${valueExpression}
`;
};

const thresholdBranch = (
  key: ProductFacetKey,
  column: string,
  operator: ">=" | "<=",
  values: readonly number[],
  query: ProductFilterQuery,
  labels: readonly string[] = values.map(String),
) =>
  values.map(
    (value, index) => Prisma.sql`
    SELECT ${key} AS facetKey, ${labels[index]} AS value, COUNT(*) AS count
    FROM base b
    ${andSql([...filterConditions(query, key), Prisma.sql`${Prisma.raw(`b.${column}`)} ${Prisma.raw(operator)} ${value}`])}
  `,
  );

const totalBranch = (query: ProductFilterQuery) => Prisma.sql`
  SELECT '__total__' AS facetKey, '__total__' AS value, COUNT(*) AS count
  FROM base b
  ${andSql(filterConditions(query))}
`;

export const queryProductFacetRows = async (
  query: ProductFilterQuery,
): Promise<FacetAggregateRow[]> => {
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
    ...thresholdBranch("minRating", "averageRating", ">=", [4, 3], query, ["4", "3"]),
    ...thresholdBranch("inStock", "quantity", ">=", [1], query, ["true"]),
  ];
  return prisma.$queryRaw<FacetAggregateRow[]>(Prisma.sql`
    WITH review_stats AS (
      SELECT productId, ROUND(AVG(rating), 1) AS averageRating, COUNT(*) AS totalReviews
      FROM reviews
      WHERE status = 'PUBLISHED' AND deletedAt IS NULL
      GROUP BY productId
    ),
    base AS (
      SELECT p.*, rs.averageRating, COALESCE(rs.totalReviews, 0) AS totalReviews
      FROM products p
      LEFT JOIN review_stats rs ON rs.productId = p.id
    )
    ${Prisma.join(branches, " UNION ALL ")}
  `);
};
