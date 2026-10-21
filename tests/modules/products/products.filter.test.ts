import { describe, expect, it } from "@jest/globals";
import { productFacetsQuery } from "modules/products/products.schema";
import { productWhere } from "modules/products/products.filter";
import { facetDefinitions } from "modules/products/products.facets";

describe("productWhere", () => {
  it("combines OR-equivalent values within groups and ANDs groups together", () => {
    const query = productFacetsQuery.parse({
      factory: "ASUS,DELL",
      cpuBrand: "INTEL",
      ramGb: "16,32",
    });
    expect(productWhere(query, { admin: false })).toEqual({
      isActive: true,
      AND: [
        { factory: { in: ["ASUS", "DELL"] } },
        { cpuBrand: { in: ["INTEL"] } },
        { ramGb: { in: [16, 32] } },
      ],
    });
  });

  it("uses non-overlapping price predicates", () => {
    const query = productFacetsQuery.parse({ price: "10-15m,15-20m" });
    expect(productWhere(query, { admin: false })).toEqual({
      isActive: true,
      AND: [
        {
          OR: [
            { price: { gte: 10_000_000, lt: 15_000_000 } },
            { price: { gte: 15_000_000, lte: 20_000_000 } },
          ],
        },
      ],
    });
  });

  it("excludes only the requested facet while retaining base and other filters", () => {
    const query = productFacetsQuery.parse({ cpuBrand: "INTEL", ramGb: "16", q: "tuf" });
    expect(productWhere(query, { admin: false, excludeFacet: "cpuBrand" })).toEqual({
      isActive: true,
      name: { contains: "tuf" },
      AND: [{ ramGb: { in: [16] } }],
    });
  });

  it("keeps admin low-stock and public in-stock constraints as separate conditions", () => {
    const query = productFacetsQuery.parse({ inStock: "true" });
    expect(productWhere({ ...query, stock: "low" }, { admin: true })).toEqual({
      AND: [{ quantity: { lte: 5 } }, { quantity: { gt: 0 } }],
    });
  });

  it("does not create null fallback matches for nullable normalized fields", () => {
    const query = productFacetsQuery.parse({ gpuType: "DEDICATED" });
    expect(productWhere(query, { admin: false })).toEqual({
      isActive: true,
      AND: [{ gpuType: { in: ["DEDICATED"] } }],
    });
  });

  it("defines one Vietnamese single-select minimum-rating facet", () => {
    const ratingFacets = facetDefinitions.filter((facet) => facet.key === "minRating");
    expect(ratingFacets).toHaveLength(1);
    expect(ratingFacets[0]).toMatchObject({
      name: "Đánh giá tối thiểu",
      mode: "SINGLE_MIN",
      options: [
        { value: "4", name: "Từ 4 sao" },
        { value: "3", name: "Từ 3 sao" },
      ],
    });
  });
});
