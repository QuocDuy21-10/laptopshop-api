import { prisma } from "config/client";
import { refreshCatalogPriceWindows } from "modules/pricing/catalog-price-projection.repository";
import { createProduct, createUser, resetDb } from "./fixtures";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("catalog price projection on MySQL", () => {
  it("keeps one continuous list-price window when no Automatic Promotion exists", async () => {
    const product = await createProduct(2, 10_000_000);
    const now = new Date("2026-10-27T00:00:00.000Z");
    const result = await prisma.$transaction((tx) =>
      refreshCatalogPriceWindows(tx, [product.id], now),
    );
    const windows = await prisma.catalogPriceWindow.findMany({ where: { productId: product.id } });
    expect(result.productCount).toBe(1);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      source: "LIST_PRICE",
      listPrice: 10_000_000,
      effectiveCatalogPrice: 10_000_000,
      validUntil: null,
    });
  });

  it("projects an active Automatic Promotion without including Flash Sale candidates", async () => {
    const admin = await createUser();
    const product = await createProduct(2, 20_000_000);
    await prisma.promotion.create({
      data: {
        kind: "AUTOMATIC",
        state: "ACTIVE",
        name: "Catalog automatic",
        discountKind: "FIXED",
        discountValue: 3_000_000,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: new Date("2026-11-01T00:00:00.000Z"),
        createdById: admin.id,
        updatedById: admin.id,
        automaticPolicy: { create: { priority: 1, stackableWithCoupon: false } },
        products: { create: { productId: product.id } },
      },
    });
    const now = new Date("2026-10-27T00:00:00.000Z");
    await prisma.$transaction((tx) => refreshCatalogPriceWindows(tx, [product.id], now));
    const windows = await prisma.catalogPriceWindow.findMany({
      where: { productId: product.id },
      orderBy: { validFrom: "asc" },
    });
    expect(
      windows.some(
        (window) => window.source === "AUTOMATIC" && window.effectiveCatalogPrice === 17_000_000,
      ),
    ).toBe(true);
  });
});
