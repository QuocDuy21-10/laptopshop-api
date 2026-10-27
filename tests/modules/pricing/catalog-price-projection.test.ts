import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import { buildCatalogPriceTimeline } from "modules/pricing/catalog-price-timeline";
import {
  catalogPriceWindowData,
  replaceCatalogPriceWindows,
} from "modules/pricing/catalog-price-projection.repository";

describe("catalog price projection persistence", () => {
  it("maps a timeline draft to a stable database row shape", () => {
    const [window] = buildCatalogPriceTimeline({
      listPrice: 10_000,
      candidates: [],
      now: new Date("2026-10-27"),
    });
    expect(catalogPriceWindowData(7, window)).toMatchObject({
      productId: 7,
      source: "LIST_PRICE",
      listPrice: 10_000,
      effectiveCatalogPrice: 10_000,
      automaticPromotionId: null,
      promotionPricingVersion: null,
      policyVersion: 1,
    });
  });

  it("replaces all windows for a product before inserting the new timeline", async () => {
    const execute = jest.fn<(query: Prisma.Sql) => Promise<number>>().mockResolvedValue(1);
    const windows = buildCatalogPriceTimeline({
      listPrice: 10_000,
      candidates: [],
      now: new Date("2026-10-27"),
    });
    await replaceCatalogPriceWindows({ $executeRaw: execute }, 7, windows);
    expect(execute).toHaveBeenCalledTimes(2);
    expect((execute.mock.calls[0][0] as { strings: string[] }).strings.join(" ")).toContain(
      "DELETE FROM catalog_price_windows",
    );
    expect((execute.mock.calls[1][0] as { strings: string[] }).strings.join(" ")).toContain(
      "INSERT INTO catalog_price_windows",
    );
  });
});
