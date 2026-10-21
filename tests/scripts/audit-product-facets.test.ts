import { describe, expect, it } from "@jest/globals";
import type { Product } from "@prisma/client";
import { buildFacetBackfillDecision } from "scripts/audit-product-facets";

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
  it("returns safe updates only for missing normalized fields", () => {
    const decision = buildFacetBackfillDecision(
      product({ cpuBrand: null, gpuBrand: null, gpuType: null, resolutionTier: null }),
    );
    expect(decision.status).toBe("safe_to_update");
    expect(decision.data).toEqual({
      cpuBrand: "INTEL",
      gpuBrand: "NVIDIA",
      gpuType: "DEDICATED",
      resolutionTier: "FHD",
    });
    expect(decision.data).not.toHaveProperty("panelType");
  });

  it("reports ambiguous GPU data without guessing its type", () => {
    const decision = buildFacetBackfillDecision(
      product({ gpu: "AMD Radeon Graphics", gpuBrand: null, gpuType: null, panelType: "IPS" }),
    );
    expect(decision.status).toBe("ambiguous");
    expect(decision.data).not.toHaveProperty("gpuType");
  });

  it("prioritizes invalid resolution over an ambiguous GPU", () => {
    const decision = buildFacetBackfillDecision(
      product({
        gpu: "AMD Radeon Graphics",
        gpuBrand: null,
        gpuType: null,
        screenResolution: "unknown",
        resolutionTier: null,
      }),
    );
    expect(decision.status).toBe("invalid_resolution");
  });

  it("reports an otherwise complete product with an unverified panel", () => {
    const decision = buildFacetBackfillDecision(product({ panelType: null }));
    expect(decision.status).toBe("unverified_panel");
    expect(decision.data).toEqual({});
  });

  it("recognizes a fully verified product", () => {
    expect(buildFacetBackfillDecision(product()).status).toBe("already_complete");
  });
});
