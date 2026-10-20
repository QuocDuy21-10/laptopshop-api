import { productSeeds } from "config/seed-products";

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
});
