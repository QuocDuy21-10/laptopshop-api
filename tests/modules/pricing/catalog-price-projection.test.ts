import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";

import { logger } from "lib/logger";
import {
  buildCatalogPriceTimeline,
  CATALOG_PRICE_WINDOW_FLOOR,
} from "modules/pricing/catalog-price-timeline";
import {
  catalogPriceWindowData,
  getEffectiveCatalogPrices,
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

describe("effective catalog prices", () => {
  const asOf = new Date("2026-10-31T00:00:00.000Z");
  const clientReturning = (rows: unknown[]) => {
    const queryRaw = jest.fn<(query: Prisma.Sql) => Promise<unknown>>().mockResolvedValue(rows);
    return { client: { $queryRaw: queryRaw } as never, queryRaw };
  };

  it("falls back to the list price when a product has no active window", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { client } = clientReturning([
      { productId: 7, listPrice: 20_000_000, effectiveCatalogPrice: null, windowCount: null },
    ]);
    await expect(getEffectiveCatalogPrices(client, [7], asOf)).resolves.toEqual(
      new Map([[7, 20_000_000]]),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ missing: [7] }),
      expect.any(String),
    );
    warn.mockRestore();
  });

  it("reads one ranked window per product so overlapping windows cannot double up", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { client, queryRaw } = clientReturning([
      {
        productId: 5,
        listPrice: 20_000_000,
        effectiveCatalogPrice: 14_000_000,
        windowCount: BigInt(2),
      },
    ]);
    await expect(getEffectiveCatalogPrices(client, [5], asOf)).resolves.toEqual(
      new Map([[5, 14_000_000]]),
    );
    const sql = (queryRaw.mock.calls[0][0] as unknown as { strings: string[] }).strings.join(" ");
    expect(sql).toContain("windowRank = 1");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ overlapping: [5] }),
      expect.any(String),
    );
    warn.mockRestore();
  });
});
