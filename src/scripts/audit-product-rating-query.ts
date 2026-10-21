import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { env } from "config/env";
import { logger } from "lib/logger";

export type ExplainSummary = {
  fullScan: boolean;
  temporaryTable: boolean;
  filesort: boolean;
};

export const buildRatingAuditQuery = () => Prisma.sql`
  /* minRating + rating_desc */
  EXPLAIN FORMAT=JSON
  WITH review_stats AS (
    SELECT productId, ROUND(AVG(rating), 1) AS averageRating, COUNT(*) AS totalReviews
    FROM reviews
    WHERE status = 'PUBLISHED' AND deletedAt IS NULL
    GROUP BY productId
  )
  SELECT p.id, rs.averageRating, COALESCE(rs.totalReviews, 0) AS totalReviews
  FROM products p
  LEFT JOIN review_stats rs ON rs.productId = p.id
  WHERE p.isActive = 1 AND COALESCE(rs.averageRating, 0) >= ${4}
  ORDER BY averageRating IS NULL ASC, averageRating DESC, totalReviews DESC, p.id ASC
  LIMIT ${10} OFFSET ${0}
`;

export const assertSafeDatabaseTarget = (databaseUrl: string, approvedTarget?: string) => {
  if (approvedTarget && databaseUrl === approvedTarget) return;
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(databaseUrl).pathname).replace(/^\//, "");
  } catch {
    throw new Error("Rating audit requires a test database target");
  }
  if (!databaseName.endsWith("_test")) {
    throw new Error("Rating audit requires a test database target");
  }
};

const inspect = (value: unknown, summary: ExplainSummary): void => {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => inspect(item, summary));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "access_type" && child === "ALL") summary.fullScan = true;
    if (key === "using_temporary_table" && child === true) summary.temporaryTable = true;
    if (key === "using_filesort" && child === true) summary.filesort = true;
    inspect(child, summary);
  }
};

export const summarizeExplainRows = (rows: unknown[]): ExplainSummary => {
  const summary: ExplainSummary = { fullScan: false, temporaryTable: false, filesort: false };
  inspect(rows, summary);
  return summary;
};

const approvedTarget = () => {
  const argument = process.argv.find((value) => value.startsWith("--allow-database="));
  return argument?.slice("--allow-database=".length);
};

export const runRatingQueryAudit = async () => {
  assertSafeDatabaseTarget(env.DATABASE_URL, approvedTarget());
  const rows = await prisma.$queryRaw<unknown[]>(buildRatingAuditQuery());
  const summary = summarizeExplainRows(rows);
  logger.info(summary, "product rating query audit complete");
  return summary;
};

if (require.main === module) {
  runRatingQueryAudit()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      logger.error({ error }, "product rating query audit failed");
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
