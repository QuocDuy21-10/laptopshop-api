import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import {
  buildCatalogPriceTimeline,
  CATALOG_PRICE_WINDOW_FLOOR,
} from "modules/pricing/catalog-price-timeline";
import {
  catalogPriceWindowData,
  refreshCatalogPriceWindows,
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

  it("opens the first refreshed window from the floor so earlier reads still resolve", async () => {
    const execute = jest.fn<(query: Prisma.Sql) => Promise<number>>().mockResolvedValue(1);
    const tx = {
      $queryRaw: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([{ id: 7 }]),
      $executeRaw: execute,
      product: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([{ id: 7, price: 10_000 }]),
      },
      promotion: {
        findMany: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([
          {
            id: 3,
            name: "Auto",
            discountKind: "FIXED",
            discountValue: 1_000,
            pricingVersion: 1,
            startsAt: new Date("2026-10-28T00:00:00.000Z"),
            endsAt: new Date("2026-10-29T00:00:00.000Z"),
            automaticPolicy: { priority: 1, stackableWithCoupon: false },
            products: [{ productId: 7, product: { price: 10_000 } }],
          },
        ]),
      },
    } as unknown as Prisma.TransactionClient;

    await refreshCatalogPriceWindows(tx, [7], new Date("2026-10-27T00:00:00.000Z"));

    const inserts = execute.mock.calls
      .map(([query]) => query as unknown as { strings: string[]; values: unknown[] })
      .filter((query) => query.strings.join(" ").includes("INSERT INTO catalog_price_windows"));
    expect(inserts.map((query) => query.values[1])).toEqual([
      CATALOG_PRICE_WINDOW_FLOOR,
      new Date("2026-10-28T00:00:00.000Z"),
      new Date("2026-10-29T00:00:00.000Z"),
    ]);
  });
});
