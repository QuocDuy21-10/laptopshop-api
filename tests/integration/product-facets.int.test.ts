import { prisma } from "config/client";
import { getProductFacets } from "modules/products/products.facets.service";
import { createCompletedOrderItem, createProduct, createUser, resetDb } from "./fixtures";
import { queryRatedProductPage } from "modules/products/products.rating.repository";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const create = (data: Record<string, unknown>) => prisma.product.create({ data: data as never });

describe("product facets on MySQL", () => {
  it("calculates self-excluding counts across groups", async () => {
    await create({
      name: "Intel primary",
      price: 15_000_000,
      quantity: 5,
      isActive: true,
      cpuBrand: "INTEL",
      gpuBrand: "NVIDIA",
      gpuType: "DEDICATED",
      ramGb: 16,
      storageGb: 512,
      screenSizeInch: 15.6,
      resolutionTier: "FHD",
      refreshRateHz: 144,
      batteryWh: 50,
      weightGrams: 2100,
      warrantyMonths: 24,
    });
    await create({
      name: "AMD alternative",
      price: 18_000_000,
      quantity: 5,
      isActive: true,
      cpuBrand: "AMD",
      gpuBrand: "AMD",
      gpuType: "DEDICATED",
      ramGb: 16,
      storageGb: 1024,
      screenSizeInch: 15.6,
      resolutionTier: "QHD",
      refreshRateHz: 120,
      batteryWh: 60,
      weightGrams: 1900,
      warrantyMonths: 12,
    });
    await create({
      name: "Intel larger RAM",
      price: 20_000_000,
      quantity: 5,
      isActive: true,
      cpuBrand: "INTEL",
      gpuBrand: "INTEL",
      gpuType: "INTEGRATED",
      ramGb: 32,
      storageGb: 1024,
      screenSizeInch: 14,
      resolutionTier: "FHD",
      refreshRateHz: 90,
      batteryWh: 40,
      weightGrams: 1500,
      warrantyMonths: 12,
    });
    await create({
      name: "Hidden Intel",
      price: 12_000_000,
      quantity: 5,
      isActive: false,
      cpuBrand: "INTEL",
      ramGb: 16,
    });
    await create({
      name: "Out of stock Intel",
      price: 12_000_000,
      quantity: 0,
      isActive: true,
      cpuBrand: "INTEL",
      ramGb: 16,
    });

    const result = await getProductFacets({
      factory: [],
      target: [],
      price: [],
      cpuBrand: ["INTEL"],
      gpuBrand: [],
      gpuType: [],
      ramGb: [16],
      storageGb: [],
      screenSize: [],
      resolutionTier: [],
      panelType: [],
      minRefreshHz: undefined,
      minBatteryWh: undefined,
      maxWeightGrams: undefined,
      minWarrantyMonths: undefined,
      inStock: undefined,
      q: undefined,
    });

    expect(result.total).toBe(2);
    expect(result.groups.cpuBrand).toEqual(
      expect.arrayContaining([
        { value: "INTEL", count: 2 },
        { value: "AMD", count: 1 },
      ]),
    );
    expect(result.groups.ramGb).toEqual(
      expect.arrayContaining([
        { value: "16", count: 2 },
        { value: "32", count: 1 },
      ]),
    );
  });

  it("parameterizes search, ignores hidden rows and applies stock only when requested", async () => {
    await create({
      name: "O'Reilly Intel",
      price: 15_000_000,
      quantity: 5,
      isActive: true,
      cpuBrand: "INTEL",
      ramGb: 16,
    });
    await create({
      name: "Hidden O'Reilly",
      price: 15_000_000,
      quantity: 5,
      isActive: false,
      cpuBrand: "INTEL",
      ramGb: 16,
    });
    await create({
      name: "O'Reilly empty",
      price: 15_000_000,
      quantity: 0,
      isActive: true,
      cpuBrand: "INTEL",
      ramGb: 16,
    });

    const all = await getProductFacets({
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
      inStock: undefined,
      q: "O'Reilly",
    });
    const inStock = await getProductFacets({ ...allQuery("O'Reilly"), inStock: true });
    expect(all.total).toBe(2);
    expect(inStock.total).toBe(1);
  });

  it("keeps null fields in unfiltered totals and returns selected zero values", async () => {
    await create({
      name: "Unknown specs",
      price: 10_000_000,
      quantity: 1,
      isActive: true,
      cpuBrand: null,
      ramGb: null,
    });
    const all = await getProductFacets(allQuery());
    const selected = await getProductFacets({ ...allQuery(), cpuBrand: ["INTEL"], ramGb: [64] });
    expect(all.total).toBe(1);
    expect(selected.total).toBe(0);
    expect(selected.groups.ramGb).toEqual(expect.arrayContaining([{ value: "64", count: 0 }]));
  });

  it("assigns price and screen boundary values to one bucket", async () => {
    await create({
      name: "Boundary",
      price: 15_000_000,
      quantity: 1,
      isActive: true,
      screenSizeInch: 14,
      ramGb: 16,
    });
    const result = await getProductFacets(allQuery());
    expect(result.groups.price).toEqual(expect.arrayContaining([{ value: "15-20m", count: 1 }]));
    expect(result.groups.price).not.toEqual(
      expect.arrayContaining([{ value: "10-15m", count: 1 }]),
    );
    expect(result.groups.screenSize).toEqual(
      expect.arrayContaining([{ value: "standard", count: 1 }]),
    );
  });

  it("returns the boolean in-stock facet using the public true value", async () => {
    await create({ name: "Available", price: 10_000_000, quantity: 2, isActive: true });
    await create({ name: "Empty", price: 10_000_000, quantity: 0, isActive: true });
    const result = await getProductFacets(allQuery());
    expect(result.groups.inStock).toEqual(expect.arrayContaining([{ value: "true", count: 1 }]));
  });

  it("keeps rating totals and self-excluding thresholds aligned", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    const fourStars = await createProduct(2, 15_000_000);
    const threeStars = await createProduct(2, 18_000_000);
    await prisma.product.update({
      where: { id: fourStars.id },
      data: { name: "Rating ASUS four", factory: "ASUS" },
    });
    await prisma.product.update({
      where: { id: threeStars.id },
      data: { name: "Rating ASUS three", factory: "ASUS" },
    });
    for (const [userId, productId, rating] of [
      [firstUser.id, fourStars.id, 4],
      [secondUser.id, threeStars.id, 3],
    ] as const) {
      const item = await createCompletedOrderItem(userId, productId);
      await prisma.review.create({
        data: {
          userId,
          productId,
          orderDetailId: item.id,
          rating,
          content: "Đánh giá",
          isAnonymous: true,
          status: "PUBLISHED",
        },
      });
    }

    const base = { ...allQuery("Rating"), price: ["10-15m", "15-20m"], factory: ["ASUS"] };
    const four = await getProductFacets({ ...base, minRating: 4 });
    const three = await getProductFacets({ ...base, minRating: 3 });
    expect(four.total).toBe(1);
    expect(three.total).toBe(2);
    expect(four.groups.minRating).toEqual(
      expect.arrayContaining([
        { value: "4", count: 1 },
        { value: "3", count: 2 },
      ]),
    );
    expect(
      (await queryRatedProductPage({ ...base, minRating: 4, page: 1, pageSize: 10 })).total,
    ).toBe(four.total);
  });
});

const allQuery = (q?: string) => ({
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
  q,
});
