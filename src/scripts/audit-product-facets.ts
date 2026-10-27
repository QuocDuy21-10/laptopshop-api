import type { Prisma, Product } from "@prisma/client";
import { prisma } from "config/client";
import { logger } from "lib/logger";
import {
  inferCpuBrand,
  inferGpuBrand,
  inferGpuType,
  inferResolutionTier,
  type ProductSpecState,
} from "modules/products/products.normalization";

export type FacetAuditIssue = {
  field: keyof ProductSpecState;
  status: "AMBIGUOUS" | "UNKNOWN" | "INVALID" | "UNVERIFIED" | "CONFLICT";
  reason: string;
};

export type FacetAuditResult = {
  updates: Partial<ProductSpecState>;
  issues: FacetAuditIssue[];
};

export type FacetAuditStatus = "COMPLETE" | "SAFE_TO_UPDATE" | FacetAuditIssue["status"];

export type FacetAuditSummary = {
  counts: Record<FacetAuditStatus, number>;
  updated: number;
  skippedConflict: number;
};

export const buildFacetAuditResult = (product: Product): FacetAuditResult => {
  const updates: Partial<ProductSpecState> = {};
  const issues: FacetAuditIssue[] = [];

  if (product.cpu) {
    const cpuBrand = inferCpuBrand(product.cpu);
    if (product.cpuBrand === null && cpuBrand) updates.cpuBrand = cpuBrand;
    else if (product.cpuBrand === null) {
      issues.push({
        field: "cpuBrand",
        status: "UNKNOWN",
        reason: "CPU brand could not be verified",
      });
    } else if (cpuBrand && product.cpuBrand !== cpuBrand) {
      issues.push({
        field: "cpuBrand",
        status: "CONFLICT",
        reason: `CPU text indicates ${cpuBrand}`,
      });
    }
  }

  if (product.gpu) {
    const brand = inferGpuBrand(product.gpu);
    const type = inferGpuType(product.gpu);
    if (product.gpuBrand === null && brand.kind === "CONFIDENT") updates.gpuBrand = brand.value;
    else if (product.gpuBrand === null && brand.kind !== "CONFIDENT") {
      issues.push({ field: "gpuBrand", status: brand.kind, reason: brand.reason });
    } else if (brand.kind === "CONFIDENT" && product.gpuBrand !== brand.value) {
      issues.push({
        field: "gpuBrand",
        status: "CONFLICT",
        reason: `GPU text indicates ${brand.value}`,
      });
    }
    if (product.gpuType === null && type.kind === "CONFIDENT") updates.gpuType = type.value;
    else if (product.gpuType === null && type.kind !== "CONFIDENT") {
      issues.push({ field: "gpuType", status: type.kind, reason: type.reason });
    } else if (type.kind === "CONFIDENT" && product.gpuType !== type.value) {
      issues.push({
        field: "gpuType",
        status: "CONFLICT",
        reason: `GPU text indicates ${type.value}`,
      });
    }
  }

  if (product.resolutionTier === null && product.screenResolution) {
    const resolutionTier = inferResolutionTier(product.screenResolution);
    if (resolutionTier) updates.resolutionTier = resolutionTier;
    else
      issues.push({
        field: "resolutionTier",
        status: "INVALID",
        reason: "Resolution does not match WIDTHxHEIGHT",
      });
  }

  if (product.panelType === null) {
    issues.push({ field: "panelType", status: "UNVERIFIED", reason: "Panel type is unverified" });
  }
  return { updates, issues };
};

const emptyCounts = (): Record<FacetAuditStatus, number> => ({
  COMPLETE: 0,
  SAFE_TO_UPDATE: 0,
  AMBIGUOUS: 0,
  UNKNOWN: 0,
  INVALID: 0,
  UNVERIFIED: 0,
  CONFLICT: 0,
});

export async function runProductFacetAudit(options: {
  apply: boolean;
}): Promise<FacetAuditSummary> {
  const products = await prisma.product.findMany({ orderBy: { id: "asc" } });
  const summary: FacetAuditSummary = { counts: emptyCounts(), updated: 0, skippedConflict: 0 };
  for (const product of products) {
    const result = buildFacetAuditResult(product);
    if (Object.keys(result.updates).length) summary.counts.SAFE_TO_UPDATE += 1;
    if (!Object.keys(result.updates).length && !result.issues.length) summary.counts.COMPLETE += 1;
    for (const issue of result.issues) summary.counts[issue.status] += 1;
    if (!options.apply || !Object.keys(result.updates).length) continue;
    const missingFields = Object.fromEntries(Object.keys(result.updates).map((key) => [key, null]));
    const updateResult = await prisma.product.updateMany({
      where: { id: product.id, ...missingFields },
      data: result.updates as Prisma.ProductUpdateInput,
    });
    summary.updated += updateResult.count;
    if (updateResult.count === 0) summary.skippedConflict += 1;
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
