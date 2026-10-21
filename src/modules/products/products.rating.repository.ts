import { Prisma } from "@prisma/client";
import { pageArgs } from "lib/http";
import type { ProductReviewSummary } from "modules/products/products.review-stats.repository";
import type { ListProductsQuery } from "modules/products/products.schema";
import { prisma } from "config/client";
import { andSql, catalogFilterConditions } from "modules/products/products.catalog-sql";

type RatingRow = {
  id: number;
  averageRating: number | string | null;
  totalReviews: bigint | number;
  total: bigint | number;
};

export type RatedProductPage = {
  productIds: number[];
  summaries: Map<number, ProductReviewSummary>;
  total: number;
};

const orderBy = (sort: ListProductsQuery["sort"]) => {
  if (sort === "rating_desc")
    return Prisma.sql`averageRating IS NULL ASC, averageRating DESC, totalReviews DESC, p.id ASC`;
  if (sort === "price_desc") return Prisma.sql`p.price DESC, p.id ASC`;
  if (sort === "price_asc") return Prisma.sql`p.price ASC, p.id ASC`;
  return Prisma.sql`p.id ASC`;
};

export const queryRatedProductPage = async (
  query: ListProductsQuery,
): Promise<RatedProductPage> => {
  const { skip, take } = pageArgs(query);
  const conditions = catalogFilterConditions(query, "p");
  conditions.push(Prisma.sql`COALESCE(rs.averageRating, 0) >= ${query.minRating ?? 0}`);
  const rows = await prisma.$queryRaw<RatingRow[]>(Prisma.sql`
    WITH review_stats AS (
      SELECT productId, ROUND(AVG(rating), 1) AS averageRating, COUNT(*) AS totalReviews
      FROM reviews
      WHERE status = 'PUBLISHED' AND deletedAt IS NULL
      GROUP BY productId
    )
    SELECT p.id, rs.averageRating, COALESCE(rs.totalReviews, 0) AS totalReviews,
      COUNT(*) OVER() AS total
    FROM products p
    LEFT JOIN review_stats rs ON rs.productId = p.id
    ${andSql(conditions)}
    ORDER BY ${orderBy(query.sort)}
    LIMIT ${take} OFFSET ${skip}
  `);
  const summaries = new Map(
    rows.map(
      (row) =>
        [
          row.id,
          {
            averageRating: row.averageRating === null ? null : Number(row.averageRating),
            totalReviews: Number(row.totalReviews),
          },
        ] as const,
    ),
  );
  return {
    productIds: rows.map((row) => row.id),
    summaries,
    total: rows.length ? Number(rows[0].total) : 0,
  };
};
