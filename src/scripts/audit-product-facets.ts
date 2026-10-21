import type { Prisma, Product } from "@prisma/client";
import { prisma } from "config/client";
import { logger } from "lib/logger";
import {
  inferCpuBrand,
  inferGpuProfile,
  inferResolutionTier,
} from "modules/products/products.normalization";

export type FacetAuditStatus =
  "already_complete" | "safe_to_update" | "ambiguous" | "unverified_panel" | "invalid_resolution";

export type FacetBackfillDecision = {
  status: FacetAuditStatus;
  data: Prisma.ProductUpdateInput;
  reasons: string[];
};

export type FacetAuditSummary = {
  counts: Record<FacetAuditStatus, number>;
  updated: number;
};

export const buildFacetBackfillDecision = (product: Product): FacetBackfillDecision => {
  const data: Prisma.ProductUpdateInput = {};
  const reasons: string[] = [];
  let ambiguous = false;
  let invalidResolution = false;

  if (product.cpuBrand === null && product.cpu) {
    const cpuBrand = inferCpuBrand(product.cpu);
    if (cpuBrand) data.cpuBrand = cpuBrand;
    else reasons.push("CPU brand could not be verified");
  }

  if (product.gpu && (product.gpuBrand === null || product.gpuType === null)) {
    const gpu = inferGpuProfile(product.gpu);
    if (gpu) {
      if (product.gpuBrand === null) data.gpuBrand = gpu.gpuBrand;
      if (product.gpuType === null) data.gpuType = gpu.gpuType;
    } else {
      ambiguous = true;
      reasons.push("GPU brand/type is ambiguous");
    }
  }

  if (product.resolutionTier === null && product.screenResolution) {
    const resolutionTier = inferResolutionTier(product.screenResolution);
    if (resolutionTier) data.resolutionTier = resolutionTier;
    else {
      invalidResolution = true;
      reasons.push("Resolution does not match WIDTHxHEIGHT");
    }
  }

  if (product.panelType === null) reasons.push("Panel type is unverified");

  if (invalidResolution) return { status: "invalid_resolution", data: {}, reasons };
  if (ambiguous) return { status: "ambiguous", data: {}, reasons };
  if (Object.keys(data).length) return { status: "safe_to_update", data, reasons };
  if (product.panelType === null) return { status: "unverified_panel", data: {}, reasons };
  return { status: "already_complete", data: {}, reasons };
};

const emptyCounts = (): Record<FacetAuditStatus, number> => ({
  already_complete: 0,
  safe_to_update: 0,
  ambiguous: 0,
  unverified_panel: 0,
  invalid_resolution: 0,
});

export async function runProductFacetAudit(options: {
  apply: boolean;
}): Promise<FacetAuditSummary> {
  const products = await prisma.product.findMany({ orderBy: { id: "asc" } });
  const summary: FacetAuditSummary = { counts: emptyCounts(), updated: 0 };
  for (const product of products) {
    const decision = buildFacetBackfillDecision(product);
    summary.counts[decision.status] += 1;
    if (!options.apply || decision.status !== "safe_to_update") continue;
    const missingFields = Object.fromEntries(Object.keys(decision.data).map((key) => [key, null]));
    const result = await prisma.product.updateMany({
      where: { id: product.id, ...missingFields },
      data: decision.data,
    });
    summary.updated += result.count;
  }
  logger.info({ apply: options.apply, ...summary }, "product facet audit complete");
  return summary;
}

if (require.main === module) {
  runProductFacetAudit({ apply: process.argv.includes("--apply") })
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      logger.error({ error }, "product facet audit failed");
      await prisma.$disconnect();
      process.exitCode = 1;
    });
}
