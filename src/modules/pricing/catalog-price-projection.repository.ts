import { Prisma } from "@prisma/client";

import { logger } from "lib/logger";
import type { CatalogPriceWindowDraft } from "modules/pricing/catalog-price-timeline";
import {
  buildCatalogPriceTimeline,
  CATALOG_PRICE_WINDOW_FLOOR,
  type CatalogPriceWindowDraft as TimelineWindow,
} from "modules/pricing/catalog-price-timeline";
import type { AutomaticPromotionCandidate } from "modules/promotions/automatic-promotion-policy";

export type CatalogPriceProjectionTx = {
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
};

type ProjectionQueryClient = {
  $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
};

type ProjectionPromotionRow = {
  id: number;
  name: string;
  discountKind: "PERCENT" | "FIXED";
  discountValue: number;
  pricingVersion: number;
  startsAt: Date;
  endsAt: Date;
  automaticPolicy: { priority: number; stackableWithCoupon: boolean } | null;
  products: Array<{ productId: number; product: { price: number } | null }>;
};

export const catalogPriceWindowData = (productId: number, window: CatalogPriceWindowDraft) => ({
  productId,
  validFrom: window.validFrom,
  validUntil: window.validUntil,
  source: window.source,
  listPrice: window.listPrice,
  effectiveCatalogPrice: window.effectiveCatalogPrice,
  automaticPromotionId: window.automaticPromotionId,
  promotionPricingVersion: window.promotionPricingVersion,
  policyVersion: window.policyVersion,
});

export const replaceCatalogPriceWindows = async (
  tx: CatalogPriceProjectionTx,
  productId: number,
  windows: readonly CatalogPriceWindowDraft[],
): Promise<number> => {
  await tx.$executeRaw(
    Prisma.sql`DELETE FROM catalog_price_windows WHERE productId = ${productId}`,
  );
  for (const window of windows) {
    const row = catalogPriceWindowData(productId, window);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO catalog_price_windows
        (productId, validFrom, validUntil, source, listPrice, effectiveCatalogPrice,
         automaticPromotionId, promotionPricingVersion, policyVersion)
      VALUES
        (${row.productId}, ${row.validFrom}, ${row.validUntil}, ${row.source}, ${row.listPrice},
         ${row.effectiveCatalogPrice}, ${row.automaticPromotionId}, ${row.promotionPricingVersion}, ${row.policyVersion})
    `);
  }
  return windows.length;
};

export const refreshCatalogPriceWindows = async (
  tx: Prisma.TransactionClient,
  productIds: readonly number[],
  now: Date,
): Promise<{ productCount: number; windowCount: number }> => {
  const ids = [...new Set(productIds)].sort((left, right) => left - right);
  if (!ids.length) return { productCount: 0, windowCount: 0 };
  await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
    SELECT id FROM products WHERE id IN (${Prisma.join(ids)}) ORDER BY id ASC FOR UPDATE
  `);
  const products =
    (await tx.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, price: true },
    })) ?? [];
  const rows = ((await tx.promotion.findMany({
    where: {
      kind: "AUTOMATIC",
      state: "ACTIVE",
      endsAt: { gt: now },
      products: { some: { productId: { in: ids } } },
    },
    include: {
      automaticPolicy: true,
      products: {
        where: { productId: { in: ids } },
        select: { productId: true, product: { select: { price: true } } },
      },
    },
  })) ?? []) as unknown as ProjectionPromotionRow[];
  const candidatesByProduct = new Map<number, AutomaticPromotionCandidate[]>();
  for (const row of rows) {
    if (!row.automaticPolicy) continue;
    for (const target of row.products) {
      const candidates = candidatesByProduct.get(target.productId) ?? [];
      candidates.push({
        id: row.id,
        name: row.name,
        discountKind: row.discountKind,
        discountValue: row.discountValue,
        priority: row.automaticPolicy.priority,
        stackableWithCoupon: row.automaticPolicy.stackableWithCoupon,
        pricingVersion: row.pricingVersion,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      });
      candidatesByProduct.set(target.productId, candidates);
    }
  }
  let windowCount = 0;
  for (const product of products) {
    const [first, ...rest]: TimelineWindow[] = buildCatalogPriceTimeline({
      listPrice: product.price,
      candidates: candidatesByProduct.get(product.id) ?? [],
      now,
    });
    const windows = [{ ...first, validFrom: CATALOG_PRICE_WINDOW_FLOOR }, ...rest];
    windowCount += await replaceCatalogPriceWindows(tx, product.id, windows);
  }
  return { productCount: products.length, windowCount };
};

// Windows active at asOf ranked per product; join on windowRank = 1 so an overlap (a data error the
// audit reports) still yields one row, and windowCount lets callers log missing or overlapping windows.
export const activeCatalogPriceWindows = (asOf: Date) => Prisma.sql`
  SELECT productId, effectiveCatalogPrice,
         COUNT(*) OVER (PARTITION BY productId) AS windowCount,
         ROW_NUMBER() OVER (PARTITION BY productId ORDER BY validFrom DESC, id DESC) AS windowRank
  FROM catalog_price_windows
  WHERE validFrom <= ${asOf} AND (validUntil IS NULL OR validUntil > ${asOf})
`;

type WindowHealthRow = { productId: number | null; windowCount: bigint | number | null };

export const warnOnUnhealthyCatalogWindows = (rows: readonly WindowHealthRow[]) => {
  const missing = rows.filter((row) => row.productId !== null && row.windowCount === null);
  const overlapping = rows.filter((row) => row.windowCount !== null && Number(row.windowCount) > 1);
  if (!missing.length && !overlapping.length) return;
  logger.warn(
    {
      missing: missing.map((row) => row.productId),
      overlapping: overlapping.map((row) => row.productId),
    },
    "catalog price windows missing or overlapping; run catalog-pricing:audit",
  );
};

export const getEffectiveCatalogPrices = async (
  client: ProjectionQueryClient,
  productIds: readonly number[],
  asOf: Date,
): Promise<Map<number, number>> => {
  const ids = [...new Set(productIds)].sort((left, right) => left - right);
  if (!ids.length) return new Map();
  const rows = await client.$queryRaw<
    {
      productId: number;
      listPrice: number;
      effectiveCatalogPrice: number | null;
      windowCount: bigint | number | null;
    }[]
  >(Prisma.sql`
    SELECT p.id AS productId, p.price AS listPrice, cpw.effectiveCatalogPrice, cpw.windowCount
    FROM products p
    LEFT JOIN (${activeCatalogPriceWindows(asOf)}) cpw ON cpw.productId = p.id AND cpw.windowRank = 1
    WHERE p.id IN (${Prisma.join(ids)})
  `);
  warnOnUnhealthyCatalogWindows(rows);
  return new Map(
    rows.map((row) => [row.productId, Number(row.effectiveCatalogPrice ?? row.listPrice)]),
  );
};
