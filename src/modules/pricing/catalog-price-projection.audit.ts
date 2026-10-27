import { Prisma } from "@prisma/client";
import { CATALOG_PRICE_POLICY_VERSION } from "modules/pricing/catalog-price-timeline";

export type CatalogPriceProjectionIssue = {
  productId: number;
  code: "MISSING" | "OVERLAP" | "STALE_POLICY" | "LIST_PRICE_MISMATCH";
  detail: string;
};

type AuditClient = { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> };
type ProjectionHealthRow = {
  productId: number;
  activeWindows: bigint | number;
  staleWindows: bigint | number;
  listPriceMismatches: bigint | number;
};

export const auditCatalogPriceProjection = async (
  client: AuditClient,
  now: Date,
): Promise<{ checked: number; issues: CatalogPriceProjectionIssue[] }> => {
  const rows = await client.$queryRaw<ProjectionHealthRow[]>(Prisma.sql`
    SELECT
      p.id AS productId,
      COUNT(w.id) AS activeWindows,
      COALESCE(SUM(CASE WHEN w.policyVersion <> ${CATALOG_PRICE_POLICY_VERSION} THEN 1 ELSE 0 END), 0) AS staleWindows,
      COALESCE(SUM(CASE WHEN w.listPrice <> p.price THEN 1 ELSE 0 END), 0) AS listPriceMismatches
    FROM products p
    LEFT JOIN catalog_price_windows w
      ON w.productId = p.id
      AND w.validFrom <= ${now}
      AND (w.validUntil IS NULL OR w.validUntil > ${now})
    GROUP BY p.id
    ORDER BY p.id ASC
  `);
  const issues: CatalogPriceProjectionIssue[] = [];
  for (const row of rows) {
    const activeWindows = Number(row.activeWindows);
    if (activeWindows === 0)
      issues.push({ productId: row.productId, code: "MISSING", detail: "No active price window" });
    if (activeWindows > 1)
      issues.push({
        productId: row.productId,
        code: "OVERLAP",
        detail: `${activeWindows} active windows`,
      });
    if (Number(row.staleWindows) > 0)
      issues.push({
        productId: row.productId,
        code: "STALE_POLICY",
        detail: "Window policyVersion is stale",
      });
    if (Number(row.listPriceMismatches) > 0)
      issues.push({
        productId: row.productId,
        code: "LIST_PRICE_MISMATCH",
        detail: "Projected listPrice differs from Product.price",
      });
  }
  return { checked: rows.length, issues };
};
