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
  gpu: true,
  ramGb: true,
  storageGb: true,
  screenSizeInch: true,
  screenResolution: true,
  refreshRateHz: true,
  batteryWh: true,
  weightGrams: true,
  warrantyMonths: true,
} satisfies Prisma.ProductSelect;

export interface AdvisorRepository {
  findCandidates(input: AdvisorInput): Promise<AdvisorCandidate[]>;
}

export class PrismaAdvisorRepository implements AdvisorRepository {
  async findCandidates(input: AdvisorInput): Promise<AdvisorCandidate[]> {
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      quantity: { gt: 0 },
      price: { lte: input.budgetMax },
      ...(input.minRamGb === undefined ? {} : { ramGb: { gte: input.minRamGb } }),
    };
    const rows = await prisma.product.findMany({
      where,
      orderBy: { id: "asc" },
      select: advisorProductSelect,
    });
    return rows as AdvisorCandidate[];
  }
}
