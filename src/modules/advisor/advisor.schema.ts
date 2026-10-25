import type { Product } from "@prisma/client";
import { z } from "zod";
import type { PricedProductDto } from "modules/products/products.mapper";
import type { ResolvedAutomaticPromotion } from "modules/promotions/promotion-resolver";

export const ADVISOR_USAGES = ["CODING", "GAMING", "OFFICE", "CREATIVE"] as const;
export const ADVISOR_PRIORITIES = [
  "PERFORMANCE",
  "PORTABILITY",
  "BATTERY",
  "DISPLAY",
  "VALUE",
] as const;
export const ADVISOR_WORKLOADS = [
  "DOCKER_VM",
  "ESPORTS",
  "AAA_GAMING",
  "PHOTO_VIDEO",
  "CAD_3D",
] as const;

const unique = (items: readonly string[]) => new Set(items).size === items.length;

export const advisorRequestSchema = z
  .object({
    budgetMax: z.coerce.number().int().min(5_000_000).max(200_000_000),
    usage: z.enum(ADVISOR_USAGES),
    priorities: z.array(z.enum(ADVISOR_PRIORITIES)).max(3).refine(unique, "Duplicate priorities"),
    minRamGb: z.union([z.literal(8), z.literal(16), z.literal(32)]).optional(),
    workloads: z
      .array(z.enum(ADVISOR_WORKLOADS))
      .max(5)
      .refine(unique, "Duplicate workloads")
      .default([]),
    note: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().max(500).optional(),
    ),
  })
  .strict();

export type AdvisorInput = z.infer<typeof advisorRequestSchema>;
export type AdvisorMode = "ai_enhanced" | "rule_based";
export type AdvisorCandidate = Omit<
  Pick<
    Product,
    | "id"
    | "name"
    | "price"
    | "image"
    | "detailDesc"
    | "shortDesc"
    | "quantity"
    | "sold"
    | "factory"
    | "target"
    | "isActive"
    | "cpu"
    | "cpuBrand"
    | "gpu"
    | "gpuBrand"
    | "gpuType"
    | "ramGb"
    | "storageGb"
    | "screenSizeInch"
    | "screenResolution"
    | "resolutionTier"
    | "panelType"
    | "refreshRateHz"
    | "batteryWh"
    | "weightGrams"
    | "warrantyMonths"
  >,
  "cpuBrand" | "gpuBrand" | "gpuType" | "resolutionTier" | "panelType"
> &
  Partial<Pick<Product, "cpuBrand" | "gpuBrand" | "gpuType" | "resolutionTier" | "panelType">>;

export type AdvisorFeature =
  "cpu" | "gpu" | "ramStorage" | "battery" | "portability" | "display" | "value";

export type AdvisorFeatureScores = Record<AdvisorFeature, number>;
export type AdvisorWeights = Record<AdvisorFeature, number>;
export type AdvisorEvidence = { key: string; text: string };

export type PricedAdvisorCandidate = {
  product: AdvisorCandidate;
  effectivePrice: number;
  automaticPromotion: ResolvedAutomaticPromotion | null;
};

export type RankedAdvisorCandidate = {
  product: AdvisorCandidate;
  effectivePrice: number;
  automaticPromotion: ResolvedAutomaticPromotion | null;
  matchScore: number;
  rawScore: number;
  features: AdvisorFeatureScores;
  evidence: AdvisorEvidence[];
};

export type AdvisorRecommendation = {
  product: PricedProductDto;
  matchScore: number;
  highlights: string[];
  reason: string;
  tradeoffs: string[];
};

export type AdvisorResult = {
  mode: AdvisorMode;
  recommendations: AdvisorRecommendation[];
  suggestions: string[];
};
