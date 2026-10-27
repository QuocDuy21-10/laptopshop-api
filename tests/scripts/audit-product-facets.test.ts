import { describe, expect, it } from "@jest/globals";
import type { Product } from "@prisma/client";
import { buildFacetAuditResult } from "scripts/audit-product-facets";

const product = (over: Partial<Product> = {}): Product => ({
  id: 1,
  name: "Laptop test",
  price: 10_000_000,
  image: null,
  detailDesc: "detail",
  shortDesc: "short",
  quantity: 1,
  sold: 0,
  factory: "ASUS",
  target: "GAMING",
  isActive: true,
  cpu: "Intel Core i5",
  cpuBrand: "INTEL",
  gpu: "NVIDIA GeForce RTX 4050",
  gpuBrand: "NVIDIA",
  gpuType: "DEDICATED",
  ramGb: 16,
  storageGb: 512,
  screenSizeInch: 15.6,
  screenResolution: "1920x1080",
  resolutionTier: "FHD",
  panelType: "IPS",
  refreshRateHz: 144,
  batteryWh: 48,
  weightGrams: 2300,
  warrantyMonths: 24,
  ...over,
});

describe("product facet audit", () => {
  it("keeps safe CPU and resolution updates when GPU type is ambiguous", () => {
    const result = buildFacetAuditResult(
      product({
        cpu: "AMD Ryzen 7",
        cpuBrand: null,
        gpu: "Intel Arc Graphics",
        gpuBrand: null,
        gpuType: null,
        resolutionTier: null,
      }),
    );
    expect(result.updates).toMatchObject({
      cpuBrand: "AMD",
      gpuBrand: "INTEL",
      resolutionTier: "FHD",
    });
    expect(result.updates).not.toHaveProperty("gpuType");
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "gpuType", status: "AMBIGUOUS" })]),
    );
  });

  it("reports unknown CPU instead of marking the product complete", () => {
    const result = buildFacetAuditResult(product({ cpu: "Unknown CPU", cpuBrand: null }));
    expect(result.updates).toEqual({});
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "cpuBrand", status: "UNKNOWN" })]),
    );
  });

  it("reports conflicts and unverified panel fields separately", () => {
    const result = buildFacetAuditResult(
      product({ cpu: "AMD Ryzen 7", cpuBrand: "INTEL", panelType: null }),
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "cpuBrand", status: "CONFLICT" }),
        expect.objectContaining({ field: "panelType", status: "UNVERIFIED" }),
      ]),
    );
  });
});
