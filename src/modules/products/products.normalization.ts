import { AppError } from "lib/errors";
import {
  CPU_BRANDS,
  GPU_BRANDS,
  GPU_TYPES,
  PANEL_TYPES,
  RESOLUTION_TIERS,
} from "modules/products/products.facets";

export type CpuBrand = (typeof CPU_BRANDS)[number];
export type GpuBrand = (typeof GPU_BRANDS)[number];
export type GpuType = (typeof GPU_TYPES)[number];
export type ResolutionTier = (typeof RESOLUTION_TIERS)[number];
export type PanelType = (typeof PANEL_TYPES)[number];

export type ProductSpecState = {
  cpu: string | null;
  cpuBrand: CpuBrand | null;
  gpu: string | null;
  gpuBrand: GpuBrand | null;
  gpuType: GpuType | null;
  screenResolution: string | null;
  resolutionTier: ResolutionTier | null;
  panelType: PanelType | null;
};

export type ProductSpecPatch = Partial<ProductSpecState>;

export const inferCpuBrand = (text: string | null | undefined): CpuBrand | null => {
  if (!text) return null;
  if (/\bintel\b/i.test(text)) return "INTEL";
  if (/\bamd\b/i.test(text)) return "AMD";
  if (/\bapple\s+(?:m\d|silicon)\b/i.test(text)) return "APPLE";
  if (/\b(?:qualcomm|snapdragon)\b/i.test(text)) return "QUALCOMM";
  return null;
};

export const inferGpuProfile = (
  text: string | null | undefined,
): { gpuBrand: GpuBrand; gpuType: GpuType } | null => {
  if (!text) return null;
  if (/\bnvidia\b/i.test(text)) return { gpuBrand: "NVIDIA", gpuType: "DEDICATED" };
  if (/\bapple\b/i.test(text)) return { gpuBrand: "APPLE", gpuType: "INTEGRATED" };
  if (/\bqualcomm\b|\badreno\b/i.test(text)) return { gpuBrand: "QUALCOMM", gpuType: "INTEGRATED" };
  if (/\bintel\b/i.test(text) && /\b(?:iris|uhd|hd)\s+graphics\b/i.test(text)) {
    return { gpuBrand: "INTEL", gpuType: "INTEGRATED" };
  }
  if (/\bintel\b/i.test(text) && /\barc\b/i.test(text)) {
    return { gpuBrand: "INTEL", gpuType: "DEDICATED" };
  }
  return null;
};

export const inferResolutionTier = (text: string | null | undefined): ResolutionTier | null => {
  if (!text) return null;
  const match = /^\s*(\d{3,5})\s*[x×]\s*(\d{3,5})\s*$/i.exec(text);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width >= 3840 && height >= 2160) return "UHD";
  if (width >= 2560 && height >= 1440) return "QHD";
  if (width >= 1920 && height >= 1080) return "FHD";
  return "HD";
};

export const mergeProductSpecState = (
  current: ProductSpecState,
  patch: ProductSpecPatch,
): ProductSpecState => {
  const next: ProductSpecState = { ...current, ...patch };
  if ("cpu" in patch && patch.cpu === null) next.cpuBrand = null;
  if ("gpu" in patch && patch.gpu === null) {
    next.gpuBrand = null;
    next.gpuType = null;
  }
  if ("screenResolution" in patch) {
    next.resolutionTier = patch.screenResolution
      ? inferResolutionTier(patch.screenResolution)
      : null;
  }
  return next;
};

export const assertProductSpecState = (state: ProductSpecState): void => {
  const details: Array<{ path: string; message: string }> = [];
  if (state.cpu && !state.cpuBrand) details.push({ path: "cpuBrand", message: "Chọn hãng CPU" });
  if (!state.cpu && state.cpuBrand)
    details.push({ path: "cpuBrand", message: "CPU không được để trống" });
  if (state.gpu && !state.gpuBrand) details.push({ path: "gpuBrand", message: "Chọn hãng GPU" });
  if (state.gpu && !state.gpuType) details.push({ path: "gpuType", message: "Chọn loại GPU" });
  if (!state.gpu && (state.gpuBrand || state.gpuType))
    details.push({ path: "gpuBrand", message: "GPU không được để trống" });
  if (state.screenResolution && !state.resolutionTier) {
    details.push({ path: "screenResolution", message: "Độ phân giải phải có dạng WIDTHxHEIGHT" });
  }
  if (details.length) {
    throw new AppError("Thông số kỹ thuật không nhất quán", 400, "INVALID_PRODUCT_SPECS", details);
  }
};
