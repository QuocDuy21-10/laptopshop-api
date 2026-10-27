jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { describe, expect, it } from "@jest/globals";
import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { queryCatalogProductPage } from "modules/products/products.catalog.repository";

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
});
