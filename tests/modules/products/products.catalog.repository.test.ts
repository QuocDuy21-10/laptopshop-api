jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { describe, expect, it } from "@jest/globals";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { queryCatalogProductPage } from "modules/products/products.catalog.repository";
import { logger } from "lib/logger";

const query = {
  factory: [],
  target: [],
  price: [],
  cpuBrand: [],
  gpuBrand: [],
  gpuType: [],
  ramGb: [],
  storageGb: [],
  screenSize: [],
  resolutionTier: [],
  panelType: [],
  minRefreshHz: undefined,
  minBatteryWh: undefined,
  maxWeightGrams: undefined,
  minWarrantyMonths: undefined,
  minRating: undefined,
  inStock: undefined,
  q: undefined,
  page: 1,
  pageSize: 12,
  sort: "price_asc" as const,
};

beforeEach(resetPrisma);

describe("public catalog repository", () => {
  it("maps projected page rows and preserves total when a page row exists", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        productId: 7,
        effectiveCatalogPrice: 14_000_000,
        averageRating: 4.5,
        totalReviews: BigInt(2),
        total: BigInt(3),
      },
    ]);
    const result = await queryCatalogProductPage(query, {
      asOf: new Date("2026-10-27T00:00:00.000Z"),
      mode: "PROJECTED",
    });
    expect(result).toEqual({
      rows: [
        { productId: 7, effectiveCatalogPrice: 14_000_000, averageRating: 4.5, totalReviews: 2 },
      ],
      total: 3,
    });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("uses list-price mode without introducing a projection join", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        productId: null,
        effectiveCatalogPrice: null,
        averageRating: null,
        totalReviews: BigInt(0),
        total: BigInt(0),
      },
    ]);
    await queryCatalogProductPage(query, { asOf: new Date(), mode: "LIST_PRICE" });
    const sql = (prismaMock.$queryRaw.mock.calls[0][0] as { strings: string[] }).strings.join(" ");
    expect(sql).not.toContain("catalog_price_windows");
  });

  it("keeps products without an active window by falling back to the list price", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    await queryCatalogProductPage(query, { asOf: new Date(), mode: "PROJECTED" });
    const sql = (prismaMock.$queryRaw.mock.calls[0][0] as { strings: string[] }).strings.join(" ");
    expect(sql).toContain("LEFT JOIN (");
    expect(sql).toContain("COALESCE(cpw.effectiveCatalogPrice, p.price)");
    expect(sql).toContain("cpw.windowRank = 1");
    expect(sql).not.toContain("INNER JOIN catalog_price_windows");
  });

  it("warns about page rows priced without exactly one active window", async () => {
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        productId: 3,
        effectiveCatalogPrice: 15_000_000,
        averageRating: null,
        totalReviews: 0,
        windowCount: null,
        total: 2,
      },
      {
        productId: 5,
        effectiveCatalogPrice: 20_000_000,
        averageRating: null,
        totalReviews: 0,
        windowCount: BigInt(2),
        total: 2,
      },
    ]);
    const result = await queryCatalogProductPage(query, { asOf: new Date(), mode: "PROJECTED" });
    expect(result.rows.map((row) => row.productId)).toEqual([3, 5]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ missing: [3], overlapping: [5] }),
      expect.any(String),
    );
    warn.mockRestore();
  });
});
