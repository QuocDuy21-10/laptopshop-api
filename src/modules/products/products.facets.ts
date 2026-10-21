import { factoryOptions, targetOptions } from "config/constant";

export const PRICE_RANGES = {
  "under-10m": { lt: 10_000_000 },
  "10-15m": { gte: 10_000_000, lt: 15_000_000 },
  "15-20m": { gte: 15_000_000, lte: 20_000_000 },
  "over-20m": { gt: 20_000_000 },
} as const;
export type PriceRange = keyof typeof PRICE_RANGES;

export const CPU_BRANDS = ["INTEL", "AMD", "APPLE", "QUALCOMM"] as const;
export const GPU_BRANDS = ["NVIDIA", "AMD", "INTEL", "APPLE", "QUALCOMM"] as const;
export const GPU_TYPES = ["INTEGRATED", "DEDICATED"] as const;
export const RESOLUTION_TIERS = ["HD", "FHD", "QHD", "UHD"] as const;
export const PANEL_TYPES = ["IPS", "OLED", "MINI_LED", "TN", "VA"] as const;
export const SCREEN_SIZES = ["compact", "standard", "large"] as const;
export const REFRESH_RATE_MINIMUMS = [60, 90, 120, 144, 165, 240] as const;
export const BATTERY_MINIMUMS = [40, 50, 60, 80] as const;
export const WEIGHT_MAXIMUMS = [1200, 1500, 2000, 2500, 3000] as const;
export const WARRANTY_MINIMUMS = [12, 24, 36] as const;
export const MIN_RATING_THRESHOLDS = [3, 4] as const;

export const FACTORIES = factoryOptions.map((o) => o.value);
export const TARGETS = targetOptions.map((o) => o.value);
export const LOW_STOCK_THRESHOLD = 5;

export type ProductFacetKey =
  | "factory"
  | "target"
  | "price"
  | "cpuBrand"
  | "gpuBrand"
  | "gpuType"
  | "ramGb"
  | "storageGb"
  | "screenSize"
  | "resolutionTier"
  | "panelType"
  | "minRefreshHz"
  | "minBatteryWh"
  | "maxWeightGrams"
  | "minWarrantyMonths"
  | "minRating"
  | "inStock";
export type FacetMode = "MULTI" | "SINGLE_MIN" | "SINGLE_MAX" | "BOOLEAN";
export type FacetKind = "categorical" | "exact" | "bucket";
export type FacetOption = { name: string; value: string };
export type FacetDefinition = {
  key: ProductFacetKey;
  name: string;
  mode: FacetMode;
  kind: FacetKind;
  options?: readonly FacetOption[];
};

const options = (values: readonly string[], names: readonly string[]): FacetOption[] =>
  values.map((value, index) => ({ value, name: names[index] ?? value }));
const numericOptions = (values: readonly number[], unit: string): FacetOption[] =>
  values.map((value) => ({ value: String(value), name: `${value} ${unit}` }));

export const facetDefinitions: readonly FacetDefinition[] = [
  {
    key: "factory",
    name: "Hãng sản xuất",
    mode: "MULTI",
    kind: "categorical",
    options: factoryOptions,
  },
  { key: "target", name: "Nhu cầu", mode: "MULTI", kind: "categorical", options: targetOptions },
  {
    key: "price",
    name: "Khoảng giá",
    mode: "MULTI",
    kind: "bucket",
    options: options(Object.keys(PRICE_RANGES), [
      "Dưới 10 triệu",
      "10 – dưới 15 triệu",
      "15 – 20 triệu",
      "Trên 20 triệu",
    ]),
  },
  {
    key: "cpuBrand",
    name: "CPU",
    mode: "MULTI",
    kind: "categorical",
    options: options(CPU_BRANDS, ["Intel", "AMD", "Apple", "Qualcomm"]),
  },
  {
    key: "gpuBrand",
    name: "Hãng GPU",
    mode: "MULTI",
    kind: "categorical",
    options: options(GPU_BRANDS, ["NVIDIA", "AMD", "Intel", "Apple", "Qualcomm"]),
  },
  {
    key: "gpuType",
    name: "Loại GPU",
    mode: "MULTI",
    kind: "categorical",
    options: options(GPU_TYPES, ["Tích hợp", "Rời"]),
  },
  { key: "ramGb", name: "RAM", mode: "MULTI", kind: "exact" },
  { key: "storageGb", name: "Ổ cứng", mode: "MULTI", kind: "exact" },
  {
    key: "screenSize",
    name: "Kích thước màn hình",
    mode: "MULTI",
    kind: "bucket",
    options: options(SCREEN_SIZES, ["Dưới 14 inch", "14 – dưới 16 inch", "Từ 16 inch"]),
  },
  {
    key: "resolutionTier",
    name: "Độ phân giải",
    mode: "MULTI",
    kind: "categorical",
    options: options(RESOLUTION_TIERS, ["HD", "Full HD", "QHD / 2K", "UHD / 4K"]),
  },
  {
    key: "panelType",
    name: "Loại tấm nền",
    mode: "MULTI",
    kind: "categorical",
    options: options(PANEL_TYPES, ["IPS", "OLED", "Mini LED", "TN", "VA"]),
  },
  {
    key: "minRefreshHz",
    name: "Tần số quét tối thiểu",
    mode: "SINGLE_MIN",
    kind: "bucket",
    options: numericOptions(REFRESH_RATE_MINIMUMS, "Hz"),
  },
  {
    key: "minBatteryWh",
    name: "Pin tối thiểu",
    mode: "SINGLE_MIN",
    kind: "bucket",
    options: numericOptions(BATTERY_MINIMUMS, "Wh"),
  },
  {
    key: "maxWeightGrams",
    name: "Trọng lượng tối đa",
    mode: "SINGLE_MAX",
    kind: "bucket",
    options: numericOptions(WEIGHT_MAXIMUMS, "g"),
  },
  {
    key: "minWarrantyMonths",
    name: "Bảo hành tối thiểu",
    mode: "SINGLE_MIN",
    kind: "bucket",
    options: numericOptions(WARRANTY_MINIMUMS, "tháng"),
  },
  {
    key: "minRating",
    name: "Đánh giá tối thiểu",
    mode: "SINGLE_MIN",
    kind: "bucket",
    options: [
      { value: "4", name: "Từ 4 sao" },
      { value: "3", name: "Từ 3 sao" },
    ],
  },
  {
    key: "inStock",
    name: "Tình trạng",
    mode: "BOOLEAN",
    kind: "categorical",
    options: [{ value: "true", name: "Còn hàng" }],
  },
];

export const publicFacetDefinitions = facetDefinitions;
