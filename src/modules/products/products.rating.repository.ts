import { Prisma } from "@prisma/client";
import { pageArgs } from "lib/http";
import type { ProductReviewSummary } from "modules/products/products.review-stats.repository";
import type { ListProductsQuery } from "modules/products/products.schema";
import { prisma } from "config/client";
import { andSql, catalogFilterConditions } from "modules/products/products.catalog-sql";

type RatingRow = {
  id: number | null;
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
    return Prisma.sql`averageRating IS NULL ASC, averageRating DESC, totalReviews DESC, id ASC`;
  if (sort === "price_desc") return Prisma.sql`price DESC, id ASC`;
  if (sort === "price_asc") return Prisma.sql`price ASC, id ASC`;
  return Prisma.sql`id ASC`;
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
    , filtered AS (
      SELECT p.id, p.price, rs.averageRating, COALESCE(rs.totalReviews, 0) AS totalReviews
      FROM products p
      LEFT JOIN review_stats rs ON rs.productId = p.id
      ${andSql(conditions)}
    ), page AS (
      SELECT * FROM filtered
      ORDER BY ${orderBy(query.sort)}
      LIMIT ${take} OFFSET ${skip}
    ), total_count AS (
      SELECT COUNT(*) AS total FROM filtered
    )
    SELECT page.id, page.averageRating, page.totalReviews, total_count.total
    FROM total_count
    LEFT JOIN page ON TRUE
  `);
  const summaries = new Map(
    rows
      .filter((row) => row.id !== null)
      .map(
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
    productIds: rows.flatMap((row) => (row.id === null ? [] : [row.id])),
    summaries,
    total: rows.length ? Number(rows[0].total) : 0,
  };
};
