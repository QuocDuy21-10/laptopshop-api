import { describe, expect, it } from "@jest/globals";
import {
  adminListProductsQuery,
  listProductsQuery,
  productFacetsQuery,
} from "modules/products/products.schema";

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

  it("accepts only the supported minimum rating thresholds", () => {
    expect(productFacetsQuery.parse({ minRating: "3" }).minRating).toBe(3);
    expect(productFacetsQuery.parse({ minRating: "4" }).minRating).toBe(4);
    for (const value of ["1", "2", "5", "3.5"]) {
      expect(() => productFacetsQuery.parse({ minRating: value })).toThrow();
    }
    expect(() => productFacetsQuery.parse({ minRating: ["3", "4"] })).toThrow();
  });

  it("allows rating_desc only for public product listing", () => {
    expect(listProductsQuery.parse({ sort: "rating_desc" }).sort).toBe("rating_desc");
    expect(() => listProductsQuery.parse({ sort: "name_asc" })).toThrow();
  });

  it("keeps admin sort allow-list explicit", () => {
    expect(adminListProductsQuery.parse({ sort: "price_desc" }).sort).toBe("price_desc");
    expect(() => adminListProductsQuery.parse({ sort: "rating_desc" })).toThrow();
  });
});
