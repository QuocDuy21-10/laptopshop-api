import { describe, expect, it } from "@jest/globals";

import { AppError } from "lib/errors";
import {
  assertProductSpecState,
  inferCpuBrand,
  inferGpuBrand,
  inferGpuProfile,
  inferGpuType,
  inferResolutionTier,
  mergeProductSpecState,
  reconcileProductSpecs,
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

  it("rejects a CPU brand that contradicts confident text inference", () => {
    expect(() => reconcileProductSpecs(state(), { cpu: "AMD Ryzen 7", cpuBrand: "INTEL" })).toThrow(
      expect.objectContaining({ code: "INVALID_PRODUCT_SPECS" }),
    );
  });

  it("replaces a stale CPU brand when changed text gives confident evidence", () => {
    expect(reconcileProductSpecs(state(), { cpu: "AMD Ryzen 7" })).toMatchObject({
      cpu: "AMD Ryzen 7",
      cpuBrand: "AMD",
    });
  });

  it("separates GPU brand confidence from ambiguous GPU type", () => {
    expect(inferGpuBrand("Intel Arc Graphics")).toMatchObject({
      kind: "CONFIDENT",
      value: "INTEL",
    });
    expect(inferGpuType("Intel Arc Graphics").kind).toBe("AMBIGUOUS");
    expect(inferGpuBrand("NVIDIA GeForce RTX 4060")).toMatchObject({
      kind: "CONFIDENT",
      value: "NVIDIA",
    });
    expect(inferGpuType("NVIDIA GeForce RTX 4060")).toMatchObject({
      kind: "CONFIDENT",
      value: "DEDICATED",
    });
  });

  it("infers Intel Iris Xe Graphics as an integrated Intel GPU", () => {
    expect(inferGpuType("Intel Iris Xe Graphics")).toMatchObject({
      kind: "CONFIDENT",
      value: "INTEGRATED",
    });
    expect(inferGpuProfile("Intel Iris Xe Graphics")).toEqual({
      gpuBrand: "INTEL",
      gpuType: "INTEGRATED",
    });
  });

  it("replaces a stale GPU type when changed text proves integrated graphics", () => {
    expect(reconcileProductSpecs(state(), { gpu: "Intel Iris Xe Graphics" })).toMatchObject({
      gpuBrand: "INTEL",
      gpuType: "INTEGRATED",
    });
  });

  it("asks for the GPU type again instead of keeping a stale one", () => {
    expect(() => reconcileProductSpecs(state(), { gpu: "Intel Arc Graphics" })).toThrow(
      expect.objectContaining({ code: "INVALID_PRODUCT_SPECS" }),
    );
  });

  it("asks for the CPU brand again instead of keeping a stale one", () => {
    expect(() => reconcileProductSpecs(state(), { cpu: "MediaTek Kompanio 1380" })).toThrow(
      expect.objectContaining({ code: "INVALID_PRODUCT_SPECS" }),
    );
  });

  it("accepts an explicit type for an ambiguous GPU text", () => {
    expect(
      reconcileProductSpecs(state(), { gpu: "Intel Arc Graphics", gpuType: "INTEGRATED" }),
    ).toMatchObject({
      gpu: "Intel Arc Graphics",
      gpuBrand: "INTEL",
      gpuType: "INTEGRATED",
    });
  });
});
