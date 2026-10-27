import { Prisma } from "@prisma/client";
import type { CatalogPriceWindowDraft } from "modules/pricing/catalog-price-timeline";

export type CatalogPriceProjectionTx = {
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
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
