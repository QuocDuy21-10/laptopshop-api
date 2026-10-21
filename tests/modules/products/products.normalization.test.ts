import { describe, expect, it } from "@jest/globals";
import { AppError } from "lib/errors";
import {
  assertProductSpecState,
  inferCpuBrand,
  inferGpuProfile,
  inferResolutionTier,
  mergeProductSpecState,
  type ProductSpecState,
} from "modules/products/products.normalization";

const state = (): ProductSpecState => ({
  cpu: "Intel Core i5",
  cpuBrand: "INTEL",
  gpu: "NVIDIA GeForce RTX 4050",
  gpuBrand: "NVIDIA",
  gpuType: "DEDICATED",
  screenResolution: "1920x1080",
  resolutionTier: "FHD",
  panelType: null,
});

describe("product spec normalization", () => {
  it("infers safe CPU, GPU and resolution values", () => {
    expect(inferCpuBrand("AMD Ryzen 7 7840U")).toBe("AMD");
    expect(inferGpuProfile("NVIDIA GeForce RTX 4050 6GB")).toEqual({
      gpuBrand: "NVIDIA",
      gpuType: "DEDICATED",
    });
    expect(inferGpuProfile("AMD Radeon Graphics")).toBeNull();
    expect(inferResolutionTier(" 2560 × 1600 ")).toBe("QHD");
    expect(inferResolutionTier("marketing text")).toBeNull();
  });

  it("clears normalized GPU fields when GPU text is cleared", () => {
    expect(mergeProductSpecState(state(), { gpu: null })).toMatchObject({
      gpu: null,
      gpuBrand: null,
      gpuType: null,
    });
  });

  it("preserves specs for a price-only patch", () => {
    expect(mergeProductSpecState(state(), {})).toEqual(state());
  });

  it("derives and clears the resolution tier with the display resolution", () => {
    expect(mergeProductSpecState(state(), { screenResolution: "3840x2160" })).toMatchObject({
      screenResolution: "3840x2160",
      resolutionTier: "UHD",
    });
    expect(mergeProductSpecState(state(), { screenResolution: null })).toMatchObject({
      screenResolution: null,
      resolutionTier: null,
    });
  });

  it("rejects a product text field without its normalized identity", () => {
    expect(() => assertProductSpecState({ ...state(), cpuBrand: null })).toThrow(AppError);
    expect(() => assertProductSpecState({ ...state(), cpuBrand: null })).toThrow(
      expect.objectContaining({ code: "INVALID_PRODUCT_SPECS", status: 400 }),
    );
  });
});
