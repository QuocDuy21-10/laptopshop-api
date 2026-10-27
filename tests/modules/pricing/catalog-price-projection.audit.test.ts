import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import { auditCatalogPriceProjection } from "modules/pricing/catalog-price-projection.audit";

describe("catalog price projection audit", () => {
  it("reports missing, overlap, stale-policy, and list-price issues from one health query", async () => {
    const queryRaw = jest.fn<(query: Prisma.Sql) => Promise<unknown>>().mockResolvedValue([
      { productId: 1, activeWindows: 0, staleWindows: 0, listPriceMismatches: 0 },
      { productId: 2, activeWindows: 2, staleWindows: 1, listPriceMismatches: 1 },
    ]);
    const result = await auditCatalogPriceProjection({ $queryRaw: queryRaw }, new Date());
    expect(result.checked).toBe(2);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: 1, code: "MISSING" }),
        expect.objectContaining({ productId: 2, code: "OVERLAP" }),
        expect.objectContaining({ productId: 2, code: "STALE_POLICY" }),
        expect.objectContaining({ productId: 2, code: "LIST_PRICE_MISMATCH" }),
      ]),
    );
  });
});
