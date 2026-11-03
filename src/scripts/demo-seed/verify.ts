import { Prisma } from "@prisma/client";

import { prisma } from "config/client";
import { verifyFlashSaleCounters } from "modules/promotions/flash-sale-verifier";
import { findLedgerMismatches } from "modules/inventory/inventory.reconciliation";
import { auditCatalogPriceProjection } from "modules/pricing/catalog-price-projection.audit";

export type DemoVerifyIssue = { check: string; detail: unknown };

// each query returns the ids that break one invariant from the spec (section 5)
const SQL_CHECKS: [string, Prisma.Sql][] = [
  ["negative_stock", Prisma.sql`SELECT id FROM products WHERE quantity < 0`],
  [
    "sold_mismatch",
    Prisma.sql`
      SELECT p.id FROM products p
      LEFT JOIN (
        SELECT od.productId, SUM(od.quantity) AS units FROM order_detail od
        JOIN orders o ON o.id = od.orderId WHERE o.status <> 'CANCELLED' GROUP BY od.productId
      ) s ON s.productId = p.id
      WHERE COALESCE(p.sold, 0) <> COALESCE(s.units, 0)`,
  ],
  [
    "order_totals",
    Prisma.sql`
      SELECT o.id FROM orders o
      JOIN (
        SELECT orderId, SUM(price * quantity) AS sub, SUM(productDiscountAmount) AS pd,
               SUM(couponDiscountAmount) AS cd
        FROM order_detail GROUP BY orderId
      ) d ON d.orderId = o.id
      WHERE o.subtotalPrice <> d.sub OR o.productDiscountAmount <> d.pd
         OR o.couponDiscountAmount <> d.cd OR o.totalPrice <> d.sub - d.pd - d.cd`,
  ],
  [
    "coupon_used_count",
    Prisma.sql`
      SELECT cp.promotionId AS id FROM coupon_policies cp
      LEFT JOIN (
        SELECT promotionId, COUNT(*) AS used FROM promotion_redemptions
        WHERE status = 'APPLIED' GROUP BY promotionId
      ) r ON r.promotionId = cp.promotionId
      WHERE cp.usedCount <> COALESCE(r.used, 0)`,
  ],
  [
    "review_not_verified",
    Prisma.sql`
      SELECT r.id FROM reviews r
      JOIN order_detail od ON od.id = r.orderDetailId
      JOIN orders o ON o.id = od.orderId
      WHERE o.status <> 'COMPLETED' OR o.userId <> r.userId OR od.productId <> r.productId
         OR r.createdAt <= o.completedAt`,
  ],
];

export const verifyDemoData = async (now: Date): Promise<DemoVerifyIssue[]> => {
  const issues: DemoVerifyIssue[] = [];
  const ledger = await findLedgerMismatches();
  if (ledger.length) issues.push({ check: "stock_ledger", detail: ledger });
  for (const [check, sql] of SQL_CHECKS) {
    const rows = await prisma.$queryRaw<{ id: number | bigint }[]>(sql);
    if (rows.length) issues.push({ check, detail: rows.map((row) => Number(row.id)) });
  }
  const flash = await verifyFlashSaleCounters(prisma);
  if (!flash.valid) issues.push({ check: "flash_sale_counters", detail: flash });
  const catalog = await auditCatalogPriceProjection(prisma, now);
  if (catalog.issues.length)
    issues.push({ check: "catalog_price_windows", detail: catalog.issues });
  return issues;
};
