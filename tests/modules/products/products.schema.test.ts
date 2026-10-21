import { describe, expect, it } from "@jest/globals";
import { productFacetsQuery } from "modules/products/products.schema";

describe("product facet query", () => {
  it("deduplicates CSV filters and parses exact numeric values", () => {
    expect(
      productFacetsQuery.parse({ cpuBrand: "INTEL,INTEL,AMD", ramGb: "8,16,16" }),
    ).toMatchObject({
      cpuBrand: ["INTEL", "AMD"],
      ramGb: [8, 16],
    });
  });

  it("rejects more than ten unique exact numeric values", () => {
    expect(() => productFacetsQuery.parse({ ramGb: "1,2,3,4,5,6,7,8,9,10,11" })).toThrow();
  });

  it("rejects unknown categorical and out-of-range threshold values", () => {
    expect(() => productFacetsQuery.parse({ cpuBrand: "UNKNOWN" })).toThrow();
    expect(() => productFacetsQuery.parse({ maxWeightGrams: "299" })).toThrow();
  });

  it("normalizes empty CSV and keeps false stock as an explicit flag", () => {
    expect(productFacetsQuery.parse({ factory: "", inStock: "false" })).toMatchObject({
      factory: [],
      inStock: false,
    });
  });
});
