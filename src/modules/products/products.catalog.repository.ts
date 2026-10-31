import { Prisma } from "@prisma/client";

import { pageArgs } from "lib/http";
import { prisma } from "config/client";
import type { ListProductsQuery } from "modules/products/products.schema";
import { andSql, catalogFilterConditions } from "modules/products/products.catalog-sql";
import {
  activeCatalogPriceWindows,
  warnOnUnhealthyCatalogWindows,
} from "modules/pricing/catalog-price-projection.repository";

export type CatalogPricingContext = { asOf: Date; mode: "LIST_PRICE" | "PROJECTED" };
export type CatalogPageRow = {
  productId: number;
  effectiveCatalogPrice: number;
  averageRating: number | null;
  totalReviews: number;
};
export type CatalogProductPage = { rows: CatalogPageRow[]; total: number };

type CatalogRow = {
  productId: number | null;
  effectiveCatalogPrice: number | string | null;
  averageRating: number | string | null;
  totalReviews: bigint | number;
  windowCount: bigint | number | null;
  total: bigint | number;
};

const orderBy = (sort: ListProductsQuery["sort"]) => {
  if (sort === "rating_desc")
    return Prisma.sql`averageRating IS NULL ASC, averageRating DESC, totalReviews DESC, productId ASC`;
  if (sort === "price_desc") return Prisma.sql`effectiveCatalogPrice DESC, productId ASC`;
  if (sort === "price_asc") return Prisma.sql`effectiveCatalogPrice ASC, productId ASC`;
  return Prisma.sql`productId ASC`;
};

export const queryCatalogProductPage = async (
  query: ListProductsQuery,
  context: CatalogPricingContext,
): Promise<CatalogProductPage> => {
  const { skip, take } = pageArgs(query);
  const effectivePrice =
    context.mode === "PROJECTED" ? Prisma.raw("b.effectiveCatalogPrice") : Prisma.raw("b.price");
  const conditions = catalogFilterConditions(query, "b", undefined, {
    priceExpression: effectivePrice,
  });
  if (query.minRating !== undefined)
    conditions.push(Prisma.sql`b.averageRating >= ${query.minRating}`);
  const projected = context.mode === "PROJECTED";
  const projectionJoin = projected
    ? Prisma.sql`LEFT JOIN (${activeCatalogPriceWindows(context.asOf)}) cpw ON cpw.productId = p.id AND cpw.windowRank = 1`
    : Prisma.empty;
  const effectiveSelect = projected
    ? Prisma.sql`COALESCE(cpw.effectiveCatalogPrice, p.price)`
    : Prisma.sql`p.price`;
  const windowCountSelect = projected ? Prisma.sql`cpw.windowCount` : Prisma.sql`1`;
  const rows = await prisma.$queryRaw<CatalogRow[]>(Prisma.sql`
    WITH review_stats AS (
      SELECT productId, ROUND(AVG(rating), 1) AS averageRating, COUNT(*) AS totalReviews
      FROM reviews WHERE status = 'PUBLISHED' AND deletedAt IS NULL GROUP BY productId
    ), base AS (
      SELECT p.id AS productId, p.price, ${effectiveSelect} AS effectiveCatalogPrice, ${windowCountSelect} AS windowCount,
             rs.averageRating, COALESCE(rs.totalReviews, 0) AS totalReviews,
             p.isActive, p.name, p.factory, p.target, p.cpuBrand, p.gpuBrand, p.gpuType,
             p.ramGb, p.storageGb, p.screenSizeInch, p.resolutionTier, p.panelType,
             p.refreshRateHz, p.batteryWh, p.weightGrams, p.warrantyMonths, p.quantity
      FROM products p LEFT JOIN review_stats rs ON rs.productId = p.id ${projectionJoin}
    ), filtered AS (
      SELECT b.productId, b.effectiveCatalogPrice, b.averageRating, b.totalReviews, b.windowCount
      FROM base b ${andSql(conditions)}
    ), page AS (
      SELECT * FROM filtered ORDER BY ${orderBy(query.sort)} LIMIT ${take} OFFSET ${skip}
    ), total_count AS (SELECT COUNT(*) AS total FROM filtered)
    SELECT page.productId, page.effectiveCatalogPrice, page.averageRating, page.totalReviews, page.windowCount, total_count.total
    FROM total_count LEFT JOIN page ON TRUE
  `);
  if (projected) warnOnUnhealthyCatalogWindows(rows);
  return {
    rows: rows
      .filter((row) => row.productId !== null)
      .map((row) => ({
        productId: row.productId!,
        effectiveCatalogPrice: Number(row.effectiveCatalogPrice),
        averageRating: row.averageRating === null ? null : Number(row.averageRating),
        totalReviews: Number(row.totalReviews),
      })),
    total: rows.length ? Number(rows[0].total) : 0,
  };
};
