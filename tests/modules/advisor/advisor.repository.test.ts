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
  it("finds active, in-stock candidates within the hard constraints", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await new PrismaAdvisorRepository().findCandidates(input);
    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          quantity: { gt: 0 },
          price: { lte: 20_000_000 },
          ramGb: { gte: 16 },
        },
        orderBy: { id: "asc" },
      }),
    );
  });

  it("does not add the RAM filter when the user leaves it unset", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await new PrismaAdvisorRepository().findCandidates({ ...input, minRamGb: undefined });
    expect(prismaMock.product.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      quantity: { gt: 0 },
      price: { lte: 20_000_000 },
    });
  });
});
