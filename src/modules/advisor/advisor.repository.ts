import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import type { AdvisorCandidate, AdvisorInput } from "modules/advisor/advisor.schema";

const advisorProductSelect = {
  id: true,
  name: true,
  price: true,
  image: true,
  detailDesc: true,
  shortDesc: true,
  quantity: true,
  sold: true,
  factory: true,
  target: true,
  isActive: true,
  cpu: true,
  cpuBrand: true,
  gpu: true,
  gpuBrand: true,
  gpuType: true,
  ramGb: true,
  storageGb: true,
  screenSizeInch: true,
  screenResolution: true,
  resolutionTier: true,
  panelType: true,
  refreshRateHz: true,
  batteryWh: true,
  weightGrams: true,
  warrantyMonths: true,
} satisfies Prisma.ProductSelect;

export interface AdvisorRepository {
  findCandidateBatch(
    input: AdvisorInput,
    page: { afterId: number; limit: number },
  ): Promise<AdvisorCandidate[]>;
}

export class PrismaAdvisorRepository implements AdvisorRepository {
  async findCandidateBatch(
    input: AdvisorInput,
    page: { afterId: number; limit: number },
  ): Promise<AdvisorCandidate[]> {
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      quantity: { gt: 0 },
      id: { gt: page.afterId },
      ...(input.minRamGb === undefined ? {} : { ramGb: { gte: input.minRamGb } }),
    };
    const rows = await prisma.product.findMany({
      where,
      orderBy: { id: "asc" },
      take: page.limit,
      select: advisorProductSelect,
    });
    return rows as AdvisorCandidate[];
  }
}
