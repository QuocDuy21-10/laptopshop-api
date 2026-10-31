import { AppError } from "lib/errors";
import {
  type CPU_BRANDS,
  type GPU_BRANDS,
  type GPU_TYPES,
  type PANEL_TYPES,
  type RESOLUTION_TIERS,
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

export type Inference<T> =
  | { kind: "CONFIDENT"; value: T; evidence: string }
  | { kind: "AMBIGUOUS"; reason: string }
  | { kind: "UNKNOWN"; reason: string };

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
  if (/\bintel\b/i.test(text) && /\b(?:iris(?:\s+xe)?|uhd|hd)\s+graphics\b/i.test(text)) {
    return { gpuBrand: "INTEL", gpuType: "INTEGRATED" };
  }
  if (/\bintel\b/i.test(text) && /\barc\b/i.test(text)) {
    return { gpuBrand: "INTEL", gpuType: "DEDICATED" };
  }
  return null;
};

const gpuBrandsIn = (text: string): GpuBrand[] => {
  const matches: GpuBrand[] = [];
  if (/\bnvidia\b|\bgeforce\b|\brtx\b|\bgtx\b/i.test(text)) matches.push("NVIDIA");
  if (/\bamd\b|\bradeon\b/i.test(text)) matches.push("AMD");
  if (/\bintel\b/i.test(text)) matches.push("INTEL");
  if (/\bapple\b/i.test(text)) matches.push("APPLE");
  if (/\bqualcomm\b|\badreno\b/i.test(text)) matches.push("QUALCOMM");
  return [...new Set(matches)];
};

export const inferGpuBrand = (text: string | null | undefined): Inference<GpuBrand> => {
  if (!text?.trim()) return { kind: "UNKNOWN", reason: "GPU text is empty" };
  const brands = gpuBrandsIn(text);
  if (brands.length === 1) return { kind: "CONFIDENT", value: brands[0], evidence: text };
  if (brands.length > 1) return { kind: "AMBIGUOUS", reason: "GPU text contains multiple brands" };
  return { kind: "UNKNOWN", reason: "GPU brand could not be verified" };
};

export const inferGpuType = (text: string | null | undefined): Inference<GpuType> => {
  if (!text?.trim()) return { kind: "UNKNOWN", reason: "GPU text is empty" };
  if (/\b(?:nvidia|geforce|rtx|gtx)\b/i.test(text) || /\bradeon\s+rx\b/i.test(text)) {
    return { kind: "CONFIDENT", value: "DEDICATED", evidence: text };
  }
  if (
    /\b(?:uhd|iris(?:\s+xe)?|hd)\s+graphics\b/i.test(text) ||
    /\badreno\b/i.test(text) ||
    /\bapple\b/i.test(text)
  ) {
    return { kind: "CONFIDENT", value: "INTEGRATED", evidence: text };
  }
  if (/\barc\b/i.test(text) || /\bradeon\s+graphics\b/i.test(text)) {
    return { kind: "AMBIGUOUS", reason: "GPU model does not prove integrated or dedicated type" };
  }
  return { kind: "UNKNOWN", reason: "GPU type could not be verified" };
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

const invalidSpecs = (details: Array<{ path: string; message: string }>): never => {
  throw new AppError("Thông số kỹ thuật không nhất quán", 400, "INVALID_PRODUCT_SPECS", details);
};

export const reconcileProductSpecs = (
  current: ProductSpecState,
  patch: ProductSpecPatch,
): ProductSpecState => {
  const next: ProductSpecState = { ...current, ...patch };
  const details: Array<{ path: string; message: string }> = [];
  const cpuTextChanged = "cpu" in patch;
  const gpuTextChanged = "gpu" in patch;

  if (cpuTextChanged && patch.cpu === null) next.cpuBrand = null;
  if (gpuTextChanged && patch.gpu === null) {
    next.gpuBrand = null;
    next.gpuType = null;
  }
  // new text the old brand/type was never checked against: drop them unless the patch restates them
  if (cpuTextChanged && !patch.cpuBrand && !inferCpuBrand(next.cpu)) next.cpuBrand = null;
  if (gpuTextChanged && !patch.gpuBrand && inferGpuBrand(next.gpu).kind !== "CONFIDENT")
    next.gpuBrand = null;
  if (gpuTextChanged && !patch.gpuType && inferGpuType(next.gpu).kind !== "CONFIDENT")
    next.gpuType = null;

  if (next.cpu) {
    const inferred = inferCpuBrand(next.cpu);
    if (cpuTextChanged && inferred && patch.cpuBrand && patch.cpuBrand !== inferred) {
      details.push({ path: "cpuBrand", message: `CPU text indicates ${inferred}` });
    }
    if (cpuTextChanged && inferred && !patch.cpuBrand) next.cpuBrand = inferred;
    if (!cpuTextChanged && inferred && next.cpuBrand && next.cpuBrand !== inferred) {
      details.push({ path: "cpuBrand", message: `CPU text indicates ${inferred}` });
    }
    if (!next.cpuBrand) details.push({ path: "cpuBrand", message: "Chọn hãng CPU" });
  }

  if (next.gpu) {
    const brandInference = inferGpuBrand(next.gpu);
    const typeInference = inferGpuType(next.gpu);
    if (
      gpuTextChanged &&
      brandInference.kind === "CONFIDENT" &&
      patch.gpuBrand &&
      patch.gpuBrand !== brandInference.value
    ) {
      details.push({ path: "gpuBrand", message: `GPU text indicates ${brandInference.value}` });
    }
    if (
      gpuTextChanged &&
      typeInference.kind === "CONFIDENT" &&
      patch.gpuType &&
      patch.gpuType !== typeInference.value
    ) {
      details.push({ path: "gpuType", message: `GPU text indicates ${typeInference.value}` });
    }
    if (gpuTextChanged && brandInference.kind === "CONFIDENT" && !patch.gpuBrand)
      next.gpuBrand = brandInference.value;
    if (gpuTextChanged && typeInference.kind === "CONFIDENT" && !patch.gpuType)
      next.gpuType = typeInference.value;
    if (
      !gpuTextChanged &&
      brandInference.kind === "CONFIDENT" &&
      next.gpuBrand &&
      next.gpuBrand !== brandInference.value
    ) {
      details.push({ path: "gpuBrand", message: `GPU text indicates ${brandInference.value}` });
    }
    if (
      !gpuTextChanged &&
      typeInference.kind === "CONFIDENT" &&
      next.gpuType &&
      next.gpuType !== typeInference.value
    ) {
      details.push({ path: "gpuType", message: `GPU text indicates ${typeInference.value}` });
    }
    if (gpuTextChanged && brandInference.kind !== "CONFIDENT" && !next.gpuBrand) {
      details.push({ path: "gpuBrand", message: brandInference.reason });
    }
    if (gpuTextChanged && typeInference.kind !== "CONFIDENT" && !next.gpuType) {
      details.push({ path: "gpuType", message: typeInference.reason });
    }
    if (!next.gpuBrand) details.push({ path: "gpuBrand", message: "Chọn hãng GPU" });
    if (!next.gpuType) details.push({ path: "gpuType", message: "Chọn loại GPU" });
  }

  if ("screenResolution" in patch) {
    next.resolutionTier = patch.screenResolution
      ? inferResolutionTier(patch.screenResolution)
      : null;
  }
  if (details.length) invalidSpecs(details);
  assertProductSpecState(next);
  return next;
};
