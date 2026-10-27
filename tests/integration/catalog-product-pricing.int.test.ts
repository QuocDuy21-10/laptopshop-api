import { prisma } from "config/client";
import { queryCatalogProductPage } from "modules/products/products.catalog.repository";
import { refreshCatalogPriceWindows } from "modules/pricing/catalog-price-projection.repository";
import { createProduct, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("promotion-aware public catalog query on MySQL", () => {
  it("uses effective catalog price for filtering and stable price sorting", async () => {
    const discounted = await createProduct(2, 18_000_000);
    const regular = await createProduct(2, 12_000_000);
    const asOf = new Date("2026-10-27T00:00:00.000Z");
    await prisma.$transaction((tx) =>
      refreshCatalogPriceWindows(tx, [discounted.id, regular.id], asOf),
    );
    const result = await queryCatalogProductPage(
      {
        factory: [],
        target: [],
        price: ["10-15m"],
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
        sort: "price_asc",
      },
      { asOf, mode: "PROJECTED" },
    );
    expect(result.rows.map((row) => row.productId)).toEqual([regular.id]);
    expect(result.rows[0].effectiveCatalogPrice).toBe(12_000_000);
    expect(result.total).toBe(1);
  });
});
