jest.mock("config/client", () => ({ prisma: require("../../helpers/prisma").prismaMock }));

import { prismaMock, resetPrisma } from "../../helpers/prisma";
import { PrismaAdvisorRepository } from "modules/advisor/advisor.repository";
import type { AdvisorInput } from "modules/advisor/advisor.schema";

const input: AdvisorInput = {
  budgetMax: 20_000_000,
  usage: "CODING",
  priorities: [],
  minRamGb: 16,
  workloads: [],
};

beforeEach(resetPrisma);

describe("PrismaAdvisorRepository", () => {
  it("finds active, in-stock candidates after a keyset cursor without list-price filtering", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await new PrismaAdvisorRepository().findCandidateBatch(input, { afterId: 10, limit: 50 });
    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          quantity: { gt: 0 },
          id: { gt: 10 },
          ramGb: { gte: 16 },
        },
        orderBy: { id: "asc" },
        take: 50,
        select: expect.objectContaining({
          cpuBrand: true,
          gpuBrand: true,
          gpuType: true,
          resolutionTier: true,
          panelType: true,
        }),
      }),
    );
  });

  it("does not add the RAM filter when the user leaves it unset", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await new PrismaAdvisorRepository().findCandidateBatch(
      { ...input, minRamGb: undefined },
      { afterId: 0, limit: 20 },
    );
    expect(prismaMock.product.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      quantity: { gt: 0 },
      id: { gt: 0 },
    });
    expect(prismaMock.product.findMany.mock.calls[0][0].take).toBe(20);
  });
});
