jest.mock("config/client", () => ({ prisma: require("../helpers/prisma").prismaMock }));
jest.mock("modules/pricing/catalog-price-projection.repository", () => ({
  refreshCatalogPriceWindows: jest.fn().mockResolvedValue({ productCount: 2, windowCount: 2 }),
}));

import initDatabase from "config/seed";
import { productSeeds } from "config/seed-products";
import {
  inferCpuBrand,
  inferGpuProfile,
  inferResolutionTier,
} from "modules/products/products.normalization";
import { refreshCatalogPriceWindows } from "modules/pricing/catalog-price-projection.repository";
import { prismaMock, resetPrisma } from "../helpers/prisma";

describe("productSeeds", () => {
  it("keeps advisor catalog metadata consistent", () => {
    const m1 = productSeeds.find((product) => product.cpu === "Apple M1");
    const m2 = productSeeds.find((product) => product.cpu === "Apple M2");
    expect(m1).toMatchObject({ name: "MacBook Air 13 M1", target: "MONG-NHE" });
    expect(m2).toMatchObject({ name: "MacBook Air 13 M2", target: "MONG-NHE" });
    expect(productSeeds.find((product) => product.name === "Laptop Acer Nitro")).toMatchObject({
      factory: "ACER",
      target: "GAMING",
    });
    expect(productSeeds.find((product) => product.name === "Laptop Acer Nitro V")).toMatchObject({
      factory: "ACER",
      target: "GAMING",
    });
  });

  it("contains complete, unique hardware metadata for every seed product", () => {
    expect(
      productSeeds.every(
        (product) =>
          product.cpu &&
          product.gpu &&
          product.ramGb &&
          product.storageGb &&
          product.weightGrams &&
          product.batteryWh,
      ),
    ).toBe(true);
    const keys = productSeeds.map((product) => `${product.name}:${product.cpu}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("contains safe normalized facet metadata for every seed product", () => {
    for (const product of productSeeds) {
      expect(product.cpuBrand).toBe(inferCpuBrand(product.cpu));
      expect(product.gpuBrand).toBe(inferGpuProfile(product.gpu)?.gpuBrand);
      expect(product.gpuType).toBe(inferGpuProfile(product.gpu)?.gpuType);
      expect(product.resolutionTier).toBe(inferResolutionTier(product.screenResolution));
      expect("panelType" in product).toBe(false);
    }
  });
});

describe("initDatabase", () => {
  it("builds catalog price windows for freshly seeded products", async () => {
    resetPrisma();
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.role.count.mockResolvedValue(2);
    prismaMock.product.count.mockResolvedValue(0);
    prismaMock.product.findMany
      .mockResolvedValueOnce([{ id: 1, quantity: 5 }])
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

    await initDatabase();

    expect(refreshCatalogPriceWindows).toHaveBeenCalledWith(prismaMock, [1, 2], expect.any(Date));
  });
});
