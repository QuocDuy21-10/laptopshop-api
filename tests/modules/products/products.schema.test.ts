import { describe, expect, it } from "@jest/globals";
import {
  adminListProductsQuery,
  listProductsQuery,
  productFacetsQuery,
} from "modules/products/products.schema";
import {
  MAX_MULTI_FACET_SELECTIONS,
  PRODUCT_FACET_KEYS,
  facetDefinitions,
} from "modules/products/products.facets";

describe("product facet query", () => {
  it("keeps the runtime key registry aligned with definitions and limits multi-selects", () => {
    expect(facetDefinitions.map((definition) => definition.key)).toEqual(PRODUCT_FACET_KEYS);
    expect(MAX_MULTI_FACET_SELECTIONS).toBe(10);
    expect(facetDefinitions.filter((definition) => definition.mode === "MULTI")).toEqual(
      expect.arrayContaining([expect.objectContaining({ maxSelections: 10 })]),
    );
  });
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
